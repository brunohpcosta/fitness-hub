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

// ─────────────────────────── read API ───────────────────────────

/** Only accept a date that looks like one. Anything else falls back. */
function safeDate(s, fallback) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

async function settingsMap(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

/**
 * Which nutrition day_type a planned session implies.
 * Deliberately derived from the plan rather than the day of the week — during
 * a taper the weekday tells you nothing.
 */
function dayTypeForPlan(plan) {
  if (!plan) return 'default';
  if (plan.session_type === 'race') return 'race';
  if (plan.is_rest) return 'rest';
  const km = plan.run_km_max ?? plan.run_km_min ?? 0;
  if (km >= 20) return 'long_run';
  return 'training';
}

/**
 * Targets for a date, with an explicit fallback.
 *
 * nutrition_targets does not carry every day_type in every window — the
 * 20–21 Aug carb-load rows are 'default' only — so asking for 'training' on
 * the 20th finds nothing. Rather than return null and show a blank screen, we
 * fall back to 'default' and SAY SO in the response. The app can then tell
 * Bruno he is seeing a general target rather than one set for that day type.
 *
 * Returns null when nothing matches at all. That is a real state, not an
 * error: the current targets expire on 22 August by design, to force a review.
 */
async function resolveTargets(env, date, dayType) {
  const pick = (dt) =>
    env.DB.prepare(
      `SELECT * FROM nutrition_targets
        WHERE day_type = ? AND ? >= effective_from
          AND (effective_to IS NULL OR ? <= effective_to)
        ORDER BY effective_from DESC LIMIT 1`
    ).bind(dt, date, date).first();

  const exact = await pick(dayType);
  if (exact) return { ...exact, matched_day_type: dayType, fell_back: 0 };

  if (dayType !== 'default') {
    const fb = await pick('default');
    if (fb) {
      return { ...fb, matched_day_type: 'default', fell_back: 1, requested_day_type: dayType };
    }
  }
  return null;
}

/**
 * How stale is the pipeline. Uses ingest_batches, which records when the phone
 * actually delivered — not the newest local_date, which can move because of a
 * historical import rather than a fresh sync.
 */
async function freshnessInfo(env, settings) {
  const row = await env.DB.prepare(
    `SELECT MAX(received_at) AS last_sync FROM ingest_batches WHERE status = 'processed'`
  ).first();

  const warnH = Number(settings.freshness_warn_hours ?? 36);
  const alertH = Number(settings.freshness_alert_hours ?? 72);
  const last = row?.last_sync ?? null;
  if (!last) return { last_sync: null, hours_since: null, status: 'unknown' };

  const hours = (Date.now() - new Date(last.replace(' ', 'T') + 'Z').getTime()) / 3600000;
  const status = hours > alertH ? 'alert' : hours > warnH ? 'warn' : 'ok';
  return { last_sync: last, hours_since: Math.round(hours * 10) / 10, status, warn_after_h: warnH, alert_after_h: alertH };
}

async function planFor(env, date) {
  const plan = await env.DB.prepare(
    `SELECT * FROM plan_sessions WHERE local_date = ? AND deleted_at IS NULL`
  ).bind(date).first();
  if (!plan) return null;

  const { results: exercises } = await env.DB.prepare(
    `SELECT ord, exercise, sets_reps, note FROM plan_exercises
      WHERE local_date = ? AND deleted_at IS NULL ORDER BY ord`
  ).bind(date).all();

  return { ...plan, exercises };
}

/**
 * One round trip for the whole Hub screen.
 *
 * Deliberately a single request: at 5am on mobile data one call that returns a
 * complete screen beats six parallel ones, and it means the screen can never
 * render half-populated.
 *
 * Every section can independently be null. A gap is a gap — the app shows it
 * as missing rather than as zero.
 */
async function handleToday(request, env) {
  const { searchParams } = new URL(request.url);
  const today = sydneyDate(new Date());
  const date = safeDate(searchParams.get('date'), today);

  const settings = await settingsMap(env);
  const plan = await planFor(env, date);
  const dayType = dayTypeForPlan(plan);

  // v_daily only produces rows for days that already have data, so today
  // frequently has none. That is expected, not an error.
  const actual = await env.DB.prepare(
    `SELECT * FROM v_daily WHERE local_date = ?`
  ).bind(date).first();

  const targets = await resolveTargets(env, date, dayType);

  const intake = await env.DB.prepare(
    `SELECT * FROM v_daily_intake WHERE local_date = ?`
  ).bind(date).first();

  // 14-day rolling body composition, per device. Never mixed across the
  // Withings/Zepp boundary — the two disagree by ~9 percentage points.
  const { results: body } = await env.DB.prepare(
    `SELECT metric, device, rolling_avg, readings, confidence
       FROM v_body_composition WHERE local_date <= ?
        AND local_date > DATE(?, '-3 days')
      ORDER BY local_date DESC`
  ).bind(date, date).all();

  const raceDate = settings.race_date ?? null;
  const daysToRace = raceDate
    ? Math.round((new Date(raceDate + 'T00:00:00Z') - new Date(date + 'T00:00:00Z')) / 86400000)
    : null;

  return Response.json({
    ok: true,
    date,
    is_today: date === today,
    plan,
    day_type: dayType,
    actual: actual ?? null,
    targets,
    intake: intake ?? null,
    body_composition: body,
    race: raceDate
      ? {
          date: raceDate,
          label: settings.race_label ?? null,
          distance_km: Number(settings.race_distance_km ?? 0) || null,
          target_minutes: Number(settings.race_target_minutes ?? 0) || null,
          fuel_g_per_hour: Number(settings.race_fuel_g_per_hour ?? 0) || null,
          gel_carbs_g: Number(settings.race_gel_carbs_g ?? 0) || null,
          days_to: daysToRace,
        }
      : null,
    freshness: await freshnessInfo(env, settings),
  });
}

/** Prescribed sessions over a range. Powers the week rail and the Training tab. */
async function handlePlan(request, env) {
  const { searchParams } = new URL(request.url);
  const today = sydneyDate(new Date());
  const from = safeDate(searchParams.get('from'), today);
  const to = safeDate(searchParams.get('to'), '2026-12-31');

  const { results: sessions } = await env.DB.prepare(
    `SELECT * FROM plan_sessions
      WHERE local_date BETWEEN ? AND ? AND deleted_at IS NULL
      ORDER BY local_date`
  ).bind(from, to).all();

  const { results: exercises } = await env.DB.prepare(
    `SELECT local_date, ord, exercise, sets_reps, note FROM plan_exercises
      WHERE local_date BETWEEN ? AND ? AND deleted_at IS NULL
      ORDER BY local_date, ord`
  ).bind(from, to).all();

  const byDate = {};
  for (const e of exercises) (byDate[e.local_date] ??= []).push(e);

  return Response.json({
    ok: true,
    from,
    to,
    count: sessions.length,
    sessions: sessions.map((s) => ({ ...s, exercises: byDate[s.local_date] ?? [] })),
  });
}

/** Daily rows over a range. Powers Summary, Body and the calendar. */
async function handleDays(request, env) {
  const { searchParams } = new URL(request.url);
  const to = safeDate(searchParams.get('to'), sydneyDate(new Date()));
  const from = safeDate(searchParams.get('from'), '2026-01-01');

  const { results } = await env.DB.prepare(
    `SELECT * FROM v_daily WHERE local_date BETWEEN ? AND ? ORDER BY local_date DESC`
  ).bind(from, to).all();

  return Response.json({ ok: true, from, to, count: results.length, days: results });
}

/**
 * Runs, plus the race-day distance spike computed live.
 *
 * The spike is never hardcoded. Two documents in this project disagreed about
 * it — one said +32%, one said +83% — because the 32 km run of 12 July fell
 * out of the 30-day window while nobody was looking. Computing it here means
 * the number cannot go stale.
 */
async function handleRuns(request, env) {
  const { searchParams } = new URL(request.url);
  const to = safeDate(searchParams.get('to'), sydneyDate(new Date()));
  const from = safeDate(searchParams.get('from'), '2026-01-01');

  const { results: runs } = await env.DB.prepare(
    `SELECT * FROM v_run_readiness WHERE local_date BETWEEN ? AND ? ORDER BY local_date DESC`
  ).bind(from, to).all();

  const settings = await settingsMap(env);
  const raceDate = settings.race_date ?? null;
  const raceKm = Number(settings.race_distance_km ?? 0) || null;

  let spike = null;
  if (raceDate && raceKm) {
    const longest = await env.DB.prepare(
      `SELECT local_date, ROUND(MAX(distance_km), 2) AS km,
              DATE(?, '-30 days') AS window_opens
         FROM workouts
        WHERE kind = 'run' AND deleted_at IS NULL
          AND local_date >= DATE(?, '-30 days') AND local_date < ?
          AND (notes IS NULL OR notes NOT LIKE 'superseded%')`
    ).bind(raceDate, raceDate, raceDate).first();

    spike = longest?.km
      ? {
          longest_km: longest.km,
          longest_date: longest.local_date,
          window_opens: longest.window_opens,
          race_km: raceKm,
          increase_pct: Math.round((raceKm / longest.km - 1) * 1000) / 10,
          basis: 'Longest run in the 30 days before race day, superseded rows excluded',
        }
      : null;
  }

  return Response.json({ ok: true, from, to, count: runs.length, runs, race_spike: spike });
}

/** Targets for a single date, day-type aware. v_daily cannot do this — its join is hardcoded to 'default'. */
async function handleTargets(request, env) {
  const { searchParams } = new URL(request.url);
  const date = safeDate(searchParams.get('date'), sydneyDate(new Date()));
  const plan = await planFor(env, date);
  // An explicit ?day_type= wins, so the Diet tab can preview a different day
  // type without a plan row existing for that date.
  const dayType = searchParams.get('day_type') || dayTypeForPlan(plan);
  const targets = await resolveTargets(env, date, dayType);

  return Response.json({
    ok: true,
    date,
    day_type: dayType,
    targets,
    // Targets expire deliberately on 22 Aug so they must be reviewed, not
    // inherited. The app says this rather than showing an empty card.
    expired: targets === null,
    review_due: (await settingsMap(env)).targets_review_due ?? null,
  });
}

// ─────────────────────────── write API ───────────────────────────

/** Every rating in this schema is 1–5, and 1 is always the bad end. */
const RATING_KEYS = [
  'sleep_quality', 'fatigue', 'soreness', 'stress', 'session_effort',
  'performance', 'strength_feel', 'session_enjoyment', 'hunger', 'cravings', 'libido',
];

/** null for absent, undefined for invalid — the caller must tell them apart. */
function rating(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined;
}

function boundedNumber(v, lo, hi) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined;
}

function textOrNull(v, max = 2000) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s.slice(0, max);
}

/**
 * The daily check-in.
 *
 * Design notes:
 *  - Everything is written with source='app'. Both target tables have source
 *    in their key, so an app row can never collide with a Withings or HAE row
 *    and the existing view precedence keeps working untouched.
 *  - Upserts use COALESCE, so saving half the form in the morning and the rest
 *    at night does not wipe the morning. Only a supplied value overwrites.
 *  - Idempotent: the same save twice is the same row. A retry from a flaky
 *    5am connection is harmless.
 *  - Invalid input is rejected with a reason. It is never coerced into
 *    something plausible — a silently corrected number is a fabricated one.
 */
async function handleLog(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  const today = sydneyDate(new Date());
  const date = safeDate(body?.local_date, null);
  if (!date) return Response.json({ error: 'local_date must be YYYY-MM-DD' }, { status: 400 });
  if (date > today) {
    return Response.json({ error: 'Cannot log a future date', today }, { status: 400 });
  }

  const errors = [];
  const r = body?.ratings ?? {};
  const ratings = {};
  for (const k of RATING_KEYS) {
    const v = rating(r[k]);
    if (v === undefined) errors.push(`${k} must be a whole number from 1 to 5`);
    else ratings[k] = v;
  }

  // CHECK constraint on the column is 0–16, not 0–24. Match it here so the
  // failure is a clear message rather than a constraint error.
  const hoursSlept = boundedNumber(r.hours_slept, 0, 16);
  if (hoursSlept === undefined) errors.push('hours_slept must be between 0 and 16');

  const waterL = boundedNumber(r.water_l, 0, 15);
  if (waterL === undefined) errors.push('water_l must be between 0 and 15');

  const weight = boundedNumber(body?.weight_kg, 40, 200);
  if (weight === undefined) errors.push('weight_kg must be between 40 and 200');

  if (errors.length) {
    return Response.json({ error: 'Validation failed', details: errors }, { status: 400 });
  }

  const notes = textOrNull(body?.notes);
  const cardioNote = textOrNull(body?.cardio_note);

  await env.DB.prepare(
    `INSERT INTO daily_log
       (local_date, hours_slept, sleep_quality, fatigue, soreness, stress,
        session_effort, notes, performance, strength_feel, session_enjoyment,
        hunger, cravings, libido, water_l, cardio_note, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'app')
     ON CONFLICT (local_date) DO UPDATE SET
       hours_slept       = COALESCE(excluded.hours_slept,       daily_log.hours_slept),
       sleep_quality     = COALESCE(excluded.sleep_quality,     daily_log.sleep_quality),
       fatigue           = COALESCE(excluded.fatigue,           daily_log.fatigue),
       soreness          = COALESCE(excluded.soreness,          daily_log.soreness),
       stress            = COALESCE(excluded.stress,            daily_log.stress),
       session_effort    = COALESCE(excluded.session_effort,    daily_log.session_effort),
       notes             = COALESCE(excluded.notes,             daily_log.notes),
       performance       = COALESCE(excluded.performance,       daily_log.performance),
       strength_feel     = COALESCE(excluded.strength_feel,     daily_log.strength_feel),
       session_enjoyment = COALESCE(excluded.session_enjoyment, daily_log.session_enjoyment),
       hunger            = COALESCE(excluded.hunger,            daily_log.hunger),
       cravings          = COALESCE(excluded.cravings,          daily_log.cravings),
       libido            = COALESCE(excluded.libido,            daily_log.libido),
       water_l           = COALESCE(excluded.water_l,           daily_log.water_l),
       cardio_note       = COALESCE(excluded.cardio_note,       daily_log.cardio_note),
       updated_at        = datetime('now')`
  ).bind(
    date, hoursSlept,
    ratings.sleep_quality, ratings.fatigue, ratings.soreness, ratings.stress,
    ratings.session_effort, notes, ratings.performance, ratings.strength_feel,
    ratings.session_enjoyment, ratings.hunger, ratings.cravings, ratings.libido,
    waterL, cardioNote
  ).run();

  // Weight goes to body_measurements, not daily_log — one home per fact.
  // A fixed occurred_at makes re-saving the same day an update, not a duplicate.
  let weightNote = null;
  if (weight !== null) {
    await env.DB.prepare(
      `INSERT INTO body_measurements
         (metric, value, units, occurred_at, local_date, source, entry_method, is_estimate)
       VALUES ('weight', ?, 'kg', ?, ?, 'app', 'manual', 0)
       ON CONFLICT (metric, occurred_at, source)
       DO UPDATE SET value = excluded.value`
    ).bind(weight, `${date}T00:00:00.000Z`, date).run();

    // v_daily_weight ranks Withings above everything else. If the scale already
    // recorded today, charts will keep showing that number — say so plainly
    // rather than let it look like the save was ignored.
    const withings = await env.DB.prepare(
      `SELECT value FROM body_measurements
        WHERE metric = 'weight' AND local_date = ? AND source = 'Withings'
          AND deleted_at IS NULL LIMIT 1`
    ).bind(date).first();

    if (withings) {
      weightNote =
        `Saved, but Withings also recorded ${Math.round(withings.value * 10) / 10} kg ` +
        `for ${date}. The scale takes precedence in charts and averages.`;
    }
  }

  const row = await env.DB.prepare(
    `SELECT * FROM daily_log WHERE local_date = ?`
  ).bind(date).first();

  return Response.json({
    ok: true,
    date,
    saved: { daily_log: true, weight: weight !== null },
    weight_note: weightNote,
    row,
  });
}

// ─────────────────────────── CORS ───────────────────────────

/**
 * A browser will not let a page on one origin read a response from another
 * unless the server says so. The phone posting from Health Auto Export is not
 * a browser, which is why this has never been needed until now.
 *
 * Origins are allowlisted rather than using '*'. Not strictly required here —
 * every endpoint is behind a bearer token anyway — but '*' would let any page
 * on the internet make authenticated calls if the token ever leaked into a
 * browser, and restricting it costs nothing.
 */
const ALLOWED_ORIGIN_EXACT = [
  'https://bruno-fitness-hub.pages.dev', // production
  'http://localhost:8788',               // python -m http.server, local testing
  'http://127.0.0.1:8788',
];

/** Preview deploys get a per-deployment hostname: <hash>.bruno-fitness-hub.pages.dev */
const ALLOWED_ORIGIN_SUFFIX = '.bruno-fitness-hub.pages.dev';

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGIN_EXACT.includes(origin)) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === 'https:' && hostname.endsWith(ALLOWED_ORIGIN_SUFFIX);
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  if (!isAllowedOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    // Responses differ by Origin, so caches must not serve one origin's
    // response to another.
    'Vary': 'Origin',
  };
}

/** Copy a response, adding CORS headers. Responses are immutable, hence the clone. */
function withCors(response, origin) {
  const headers = corsHeaders(origin);
  if (!Object.keys(headers).length) return response;
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

// ─────────────────────────── router ───────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = (response) => withCors(response, origin);

    // Preflight is answered BEFORE the auth check, deliberately.
    //
    // Before a cross-origin request carrying an Authorization header, the
    // browser sends a separate OPTIONS request asking permission — and that
    // request does NOT include the header. If the auth gate below ran first it
    // would return 401, the browser would never send the real request, and the
    // failure would surface as an opaque CORS error rather than an auth one.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: isAllowedOrigin(origin) ? 204 : 403,
        headers: corsHeaders(origin),
      });
    }

    if (url.pathname === '/health') {
      return cors(Response.json({
        ok: true, service: 'fitness-hub-api', time: new Date().toISOString(),
      }));
    }

    if (!env.INGEST_SECRET) {
      return cors(Response.json(
        { error: 'Server misconfigured: INGEST_SECRET is not set' }, { status: 500 }
      ));
    }

    if (!safeEqual(request.headers.get('Authorization'), `Bearer ${env.INGEST_SECRET}`)) {
      return cors(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    }

    if (url.pathname === '/ingest/raw' && request.method === 'POST')
      return cors(await handleRawIngest(request, env));

    if (url.pathname === '/ingest/replay' && request.method === 'POST')
      return cors(await handleReplay(request, env));

    if (url.pathname === '/ingest/list' && request.method === 'GET')
      return cors(await handleList(env));

    if (url.pathname === '/data/summary' && request.method === 'GET')
      return cors(await handleSummary(env));

    // ── read API for the front end ──
    if (url.pathname === '/api/today' && request.method === 'GET')
      return cors(await handleToday(request, env));

    if (url.pathname === '/api/plan' && request.method === 'GET')
      return cors(await handlePlan(request, env));

    if (url.pathname === '/api/days' && request.method === 'GET')
      return cors(await handleDays(request, env));

    if (url.pathname === '/api/runs' && request.method === 'GET')
      return cors(await handleRuns(request, env));

    if (url.pathname === '/api/targets' && request.method === 'GET')
      return cors(await handleTargets(request, env));

    if (url.pathname === '/api/log' && request.method === 'POST')
      return cors(await handleLog(request, env));

    return cors(Response.json(
      { error: 'Not found', path: url.pathname, method: request.method },
      { status: 404 }
    ));
  },
};
