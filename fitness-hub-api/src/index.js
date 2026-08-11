/**
 * Fitness Hub API
 *
 *   GET  /health        — open, confirms the Worker is alive
 *   POST /ingest/raw    — stores the payload in R2, then parses it into tables
 *   GET  /ingest/list   — recent deliveries
 *   POST /ingest/replay — re-parse a stored payload by its R2 key
 *   GET  /data/summary  — what's actually in the database
 *
 * Design notes:
 *  - Raw payloads are ALWAYS stored before parsing. If parsing fails the data
 *    survives, and /ingest/replay can re-run it once the bug is fixed.
 *  - Nothing is trusted to be present. Every field is checked before use, so a
 *    payload missing something produces a gap, never a wrong number.
 *  - Units are read from the payload, never assumed.
 */

// ─────────────────────────── helpers ───────────────────────────

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * HAE sends dates as "2026-08-11 04:57:30 +1000".
 * Returns { iso, localDate } or null if unparseable.
 * Never guesses — an unreadable date means the row is skipped, not invented.
 */
function parseHaeDate(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*([+-]\d{2}):?(\d{2})$/
  );
  if (!m) {
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return { iso: d.toISOString(), localDate: sydneyDate(d) };
  }
  const [, y, mo, dd, hh, mi, ss, offH, offM] = m;
  const iso = `${y}-${mo}-${dd}T${hh}:${mi}:${ss}${offH}:${offM}`;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  // The local date is the one in the payload's own offset — for Sydney data
  // that is the Sydney calendar day, which is what we want.
  return { iso: d.toISOString(), localDate: `${y}-${mo}-${dd}` };
}

function sydneyDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Energy arrives in kJ from this phone. 1 kcal = 4.184 kJ. */
function toKcal(value, units) {
  if (value == null) return null;
  const u = String(units || '').toLowerCase();
  if (u === 'kj') return value / 4.184;
  return value;
}

function toKm(value, units) {
  if (value == null) return null;
  const u = String(units || '').toLowerCase();
  if (u === 'mi') return value * 1.609344;
  return value;
}

function toCelsius(value, units) {
  if (value == null) return null;
  const u = String(units || '').toLowerCase();
  if (u === 'degf' || u === 'f') return (value - 32) * 5 / 9;
  return value;
}

/** Which metrics belong in body_measurements rather than health_metrics. */
const BODY_METRICS = {
  weight_body_mass: 'weight',
  body_fat_percentage: 'body_fat_pct',
  lean_body_mass: 'lean_mass',
  body_mass_index: null, // derived from weight and height — not stored
  waist_circumference: 'waist',
};

/** Run in batches — D1 allows 100 bound parameters per statement. */
async function runBatched(env, statements, chunkSize = 20) {
  let applied = 0;
  for (let i = 0; i < statements.length; i += chunkSize) {
    const chunk = statements.slice(i, i + chunkSize);
    await env.DB.batch(chunk);
    applied += chunk.length;
  }
  return applied;
}

// ─────────────────────────── parsing ───────────────────────────

function parseMetrics(payload, batchId, dailyTotalSet, env) {
  const stmts = [];
  const counts = { body: 0, metric: 0, skipped: 0, aggregated: 0 };

  const metrics = payload?.data?.metrics;
  if (!Array.isArray(metrics)) return { stmts, counts };

  for (const metric of metrics) {
    const name = metric?.name;
    const units = metric?.units ?? '';
    const points = Array.isArray(metric?.data) ? metric.data : [];
    if (!name) continue;

    // ---- metrics rolled up to one row per day ----
    if (dailyTotalSet.has(name)) {
      const perDay = new Map();
      for (const p of points) {
        const when = parseHaeDate(p?.date);
        const qty = num(p?.qty);
        if (!when || qty == null) { counts.skipped++; continue; }
        const key = `${when.localDate}|${p?.source ?? 'unknown'}`;
        if (!perDay.has(key)) {
          perDay.set(key, {
            localDate: when.localDate,
            source: p?.source ?? 'unknown',
            total: 0,
          });
        }
        perDay.get(key).total += qty;
      }

      for (const day of perDay.values()) {
        const isEnergy = name.includes('energy');
        const value = isEnergy ? toKcal(day.total, units) : day.total;
        const storedUnits = isEnergy ? 'kcal' : units;
        stmts.push(
          env.DB.prepare(
            `INSERT INTO health_metrics
               (metric_name, value, units, occurred_at, local_date, source, aggregation, ingest_batch_id)
             VALUES (?, ?, ?, ?, ?, ?, 'daily_total', ?)
             ON CONFLICT (metric_name, occurred_at, source)
             DO UPDATE SET value = excluded.value, ingest_batch_id = excluded.ingest_batch_id`
          ).bind(
            name, value, storedUnits,
            `${day.localDate}T00:00:00.000Z`,
            day.localDate, day.source, batchId
          )
        );
        counts.aggregated++;
      }
      continue;
    }

    // ---- everything else, point by point ----
    for (const p of points) {
      const when = parseHaeDate(p?.date);
      if (!when) { counts.skipped++; continue; }

      const source = p?.source ?? 'unknown';
      const qty = num(p?.qty);
      const vMin = num(p?.Min);
      const vAvg = num(p?.Avg);
      const vMax = num(p?.Max);
      const value = qty ?? vAvg;

      if (value == null && vMin == null && vMax == null) {
        counts.skipped++;
        continue;
      }

      const bodyMetric = Object.prototype.hasOwnProperty.call(BODY_METRICS, name)
        ? BODY_METRICS[name]
        : undefined;

      if (bodyMetric === null) continue;       // known but deliberately not stored
      if (bodyMetric !== undefined) {
        stmts.push(
          env.DB.prepare(
            `INSERT INTO body_measurements
               (metric, value, units, occurred_at, local_date, source, entry_method, ingest_batch_id)
             VALUES (?, ?, ?, ?, ?, ?, 'automatic', ?)
             ON CONFLICT (metric, occurred_at, source)
             DO UPDATE SET value = excluded.value, ingest_batch_id = excluded.ingest_batch_id`
          ).bind(bodyMetric, value, units, when.iso, when.localDate, source, batchId)
        );
        counts.body++;
      } else {
        const isEnergy = name.includes('energy');
        stmts.push(
          env.DB.prepare(
            `INSERT INTO health_metrics
               (metric_name, value, value_min, value_max, units, occurred_at, local_date, source, aggregation, ingest_batch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'point', ?)
             ON CONFLICT (metric_name, occurred_at, source)
             DO UPDATE SET value = excluded.value, ingest_batch_id = excluded.ingest_batch_id`
          ).bind(
            name,
            isEnergy ? toKcal(value, units) : value,
            vMin, vMax,
            isEnergy ? 'kcal' : units,
            when.iso, when.localDate, source, batchId
          )
        );
        counts.metric++;
      }
    }
  }

  return { stmts, counts };
}

function classifyWorkout(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('run')) return 'run';
  if (n.includes('walk') || n.includes('hik')) return 'walk';
  if (n.includes('cycl') || n.includes('bike')) return 'cycle';
  if (n.includes('strength') || n.includes('traditional') || n.includes('functional'))
    return 'strength';
  return 'other';
}

function parseWorkouts(payload, batchId, env) {
  const stmts = [];
  const counts = { workouts: 0, hrPoints: 0, skipped: 0 };

  const workouts = payload?.data?.workouts;
  if (!Array.isArray(workouts)) return { stmts, counts };

  for (const w of workouts) {
    const started = parseHaeDate(w?.start);
    const ended = parseHaeDate(w?.end);
    if (!started || !w?.id) { counts.skipped++; continue; }

    // duration arrives in SECONDS — confirmed against a real payload
    const durationMin = num(w?.duration) != null ? num(w.duration) / 60 : null;
    const distanceKm = toKm(num(w?.distance?.qty), w?.distance?.units);
    const paceSecPerKm =
      distanceKm && durationMin && distanceKm > 0
        ? (durationMin * 60) / distanceKm
        : null;

    stmts.push(
      env.DB.prepare(
        `INSERT INTO workouts
           (kind, started_at, ended_at, local_date, duration_min, title,
            distance_km, avg_pace_sec_per_km, avg_heart_rate, max_heart_rate,
            active_energy_kcal, temperature_c, humidity_pct,
            hae_workout_id, source, entry_method, ingest_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'health_auto_export', 'automatic', ?)
         ON CONFLICT (hae_workout_id) DO UPDATE SET
           ended_at            = excluded.ended_at,
           duration_min        = excluded.duration_min,
           distance_km         = excluded.distance_km,
           avg_pace_sec_per_km = excluded.avg_pace_sec_per_km,
           avg_heart_rate      = excluded.avg_heart_rate,
           max_heart_rate      = excluded.max_heart_rate,
           active_energy_kcal  = excluded.active_energy_kcal,
           temperature_c       = excluded.temperature_c,
           humidity_pct        = excluded.humidity_pct,
           ingest_batch_id     = excluded.ingest_batch_id`
      ).bind(
        classifyWorkout(w?.name),
        started.iso,
        ended ? ended.iso : null,
        started.localDate,
        durationMin,
        w?.name ?? null,
        distanceKm,
        paceSecPerKm,
        num(w?.avgHeartRate?.qty) ?? num(w?.heartRate?.avg),
        num(w?.maxHeartRate?.qty) ?? num(w?.heartRate?.max),
        toKcal(num(w?.activeEnergyBurned?.qty), w?.activeEnergyBurned?.units),
        toCelsius(num(w?.temperature?.qty), w?.temperature?.units),
        num(w?.humidity?.qty),
        w.id,
        batchId
      )
    );
    counts.workouts++;

    // heart-rate trace, keyed to the workout by its HAE id
    const hrPoints = Array.isArray(w?.heartRateData) ? w.heartRateData : [];
    for (const p of hrPoints) {
      const when = parseHaeDate(p?.date);
      const avg = num(p?.Avg);
      if (!when || avg == null) { counts.skipped++; continue; }

      stmts.push(
        env.DB.prepare(
          `INSERT INTO workout_heart_rate (workout_id, occurred_at, hr_min, hr_avg, hr_max)
           SELECT id, ?, ?, ?, ? FROM workouts WHERE hae_workout_id = ?
           ON CONFLICT (workout_id, occurred_at)
           DO UPDATE SET hr_avg = excluded.hr_avg,
                         hr_min = excluded.hr_min,
                         hr_max = excluded.hr_max`
        ).bind(when.iso, num(p?.Min), avg, num(p?.Max), w.id)
      );
      counts.hrPoints++;
    }
  }

  return { stmts, counts };
}

// ─────────────────────────── handlers ───────────────────────────

async function getDailyTotalSet(env) {
  const row = await env.DB.prepare(
    `SELECT value FROM settings WHERE key = 'daily_total_metrics'`
  ).first();
  const csv = row?.value ?? 'step_count,active_energy';
  return new Set(csv.split(',').map((s) => s.trim()).filter(Boolean));
}

async function parseAndStore(payload, batchId, env) {
  const dailyTotalSet = await getDailyTotalSet(env);
  const m = parseMetrics(payload, batchId, dailyTotalSet, env);
  const w = parseWorkouts(payload, batchId, env);

  // Workouts must exist before their heart-rate rows reference them.
  await runBatched(env, w.stmts);
  await runBatched(env, m.stmts);

  return { metrics: m.counts, workouts: w.counts };
}

async function handleRawIngest(request, env) {
  const sessionId = request.headers.get('session-id') || `manual-${Date.now()}`;
  const automationId = request.headers.get('automation-id');
  const automationName = request.headers.get('automation-name');
  const contentType = request.headers.get('content-type');

  const existing = await env.DB.prepare(
    'SELECT id, r2_key, status FROM ingest_batches WHERE session_id = ?'
  ).bind(sessionId).first();

  if (existing) {
    return Response.json({
      ok: true, duplicate: true, session_id: sessionId, stored: existing.r2_key,
    });
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) {
    return Response.json({ error: 'Empty body' }, { status: 400 });
  }

  const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
  const key = `raw/${sydneyDate(new Date())}/${safeSession}.json`;

  // Store the raw bytes FIRST. Parsing can fail; the data must not be lost.
  await env.RAW.put(key, bytes, {
    httpMetadata: { contentType: contentType || 'application/json' },
  });

  const inserted = await env.DB.prepare(
    `INSERT INTO ingest_batches
       (session_id, automation_id, automation_name, byte_size, status, r2_key, content_type)
     VALUES (?, ?, ?, ?, 'received', ?, ?)
     RETURNING id`
  ).bind(
    sessionId, automationId, automationName, bytes.byteLength, key, contentType
  ).first();

  const batchId = inserted?.id ?? null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    const result = await parseAndStore(payload, batchId, env);

    await env.DB.prepare(
      `UPDATE ingest_batches SET status = 'processed' WHERE id = ?`
    ).bind(batchId).run();

    return Response.json({
      ok: true, stored: key, bytes: bytes.byteLength,
      automation: automationName, parsed: result,
    });
  } catch (err) {
    await env.DB.prepare(
      `UPDATE ingest_batches SET status = 'failed', error_detail = ? WHERE id = ?`
    ).bind(String(err?.message ?? err).slice(0, 500), batchId).run();

    // 200 on purpose: the raw payload IS saved. Returning an error would make
    // the phone retry a delivery that already succeeded.
    return Response.json({
      ok: true, stored: key, bytes: bytes.byteLength,
      parse_error: String(err?.message ?? err).slice(0, 300),
      note: 'Raw payload stored. Re-run with /ingest/replay once fixed.',
    });
  }
}

async function handleReplay(request, env) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');
  if (!key) return Response.json({ error: 'Missing ?key=' }, { status: 400 });

  const obj = await env.RAW.get(key);
  if (!obj) return Response.json({ error: 'Key not found' }, { status: 404 });

  const batch = await env.DB.prepare(
    'SELECT id FROM ingest_batches WHERE r2_key = ?'
  ).bind(key).first();

  try {
    const payload = await obj.json();
    const result = await parseAndStore(payload, batch?.id ?? null, env);
    if (batch?.id) {
      await env.DB.prepare(
        `UPDATE ingest_batches SET status = 'processed', error_detail = NULL WHERE id = ?`
      ).bind(batch.id).run();
    }
    return Response.json({ ok: true, key, parsed: result });
  } catch (err) {
    return Response.json(
      { ok: false, key, error: String(err?.message ?? err).slice(0, 300) },
      { status: 500 }
    );
  }
}

async function handleList(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, session_id, automation_name, received_at, byte_size, status, r2_key, error_detail
       FROM ingest_batches ORDER BY received_at DESC LIMIT 20`
  ).all();
  return Response.json({ ok: true, count: results.length, batches: results });
}

async function handleSummary(env) {
  const q = async (sql) => (await env.DB.prepare(sql).all()).results;

  return Response.json({
    ok: true,
    body_measurements: await q(
      `SELECT metric, source, COUNT(*) AS n,
              MIN(local_date) AS first, MAX(local_date) AS last
         FROM body_measurements WHERE deleted_at IS NULL
        GROUP BY metric, source ORDER BY metric`
    ),
    health_metrics: await q(
      `SELECT metric_name, units, aggregation, source, COUNT(*) AS n,
              MIN(local_date) AS first, MAX(local_date) AS last
         FROM health_metrics GROUP BY metric_name, units, aggregation, source
        ORDER BY metric_name`
    ),
    workouts: await q(
      `SELECT kind, COUNT(*) AS n, MIN(local_date) AS first, MAX(local_date) AS last
         FROM workouts WHERE deleted_at IS NULL GROUP BY kind`
    ),
    heart_rate_points: await q(`SELECT COUNT(*) AS n FROM workout_heart_rate`),
  });
}

// ─────────────────────────── router ───────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({
        ok: true, service: 'fitness-hub-api', time: new Date().toISOString(),
      });
    }

    if (!env.INGEST_SECRET) {
      return Response.json(
        { error: 'Server misconfigured: INGEST_SECRET is not set' }, { status: 500 }
      );
    }

    if (!safeEqual(request.headers.get('Authorization'), `Bearer ${env.INGEST_SECRET}`)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (url.pathname === '/ingest/raw' && request.method === 'POST')
      return handleRawIngest(request, env);

    if (url.pathname === '/ingest/replay' && request.method === 'POST')
      return handleReplay(request, env);

    if (url.pathname === '/ingest/list' && request.method === 'GET')
      return handleList(env);

    if (url.pathname === '/data/summary' && request.method === 'GET')
      return handleSummary(env);

    return Response.json(
      { error: 'Not found', path: url.pathname, method: request.method },
      { status: 404 }
    );
  },
};
