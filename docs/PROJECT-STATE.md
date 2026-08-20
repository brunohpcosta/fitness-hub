# Fitness Hub — project state

**Last updated:** 12 August 2026, end of Stage 4.
**Purpose:** everything a new conversation needs. Replaces reading the build history.

---

## 1. Who and what

Bruno, Sydney (Northern Beaches). **First development project** — explain concepts, commands and
decisions in plain language before running them. No assumed knowledge of tooling.

Building **Fitness Hub v3**. v2 (Google Sheets + Apps Script + Netlify) is now superseded by a
working v3 front end, but has not been switched off.

**Training:** 6+ years lifting. Push / Legs / Pull / Delts+Arms / Upper+Abs, runs Tue / Thu / Sun,
5am at World Gym Northern Beaches. Knee history informs programming. **The Saturday session in the
standing split is not recorded anywhere in v3** — it lives in v2 and was never captured.

**Current goal:** solo 42.195 km on **22 August 2026**, target **sub-4 hours (5:41/km)**.
Weight ~78.7 kg (7-day average), goal 76 kg. After the run: review goals, likely lean-gain phase.

---

## 2. Stack and access

| Thing | Value |
|---|---|
| Worker | `https://fitness-hub-api.bruno-hpc93.workers.dev` |
| **Front end** | `https://bruno-fitness-hub.pages.dev` — Cloudflare Pages, project `bruno-fitness-hub` |
| D1 database | `fitness-hub-db`, region OC, id `5fe1ec3e-7530-4765-8c1c-a4b03110be8a` |
| R2 buckets | `fitness-hub-photos`, `fitness-hub-raw` |
| Bindings | `DB`, `PHOTOS`, `RAW`, `INGEST_SECRET` |
| Repo | `github.com/brunohpcosta/fitness-hub`, local `~/Documents/fitness-hub` |
| Worker code | `fitness-hub-api/src/index.js` |
| App code | `fitness-hub-app/public/index.html` — one file, no build step |
| Source data | `~/Documents/Fitness/` — photos at `~/Documents/Fitness/fitness-hub/01-photos/` |
| Plan | Cloudflare **free tier** throughout. Confirmed sufficient. |

**Wrangler 4.120.x, pinned in `fitness-hub-api/package.json`.** `compatibility_date` must be
~2 days behind today or the local runtime refuses to start.

**Deploy commands**

```
cd ~/Documents/fitness-hub/fitness-hub-api && npx wrangler deploy
cd ~/Documents/fitness-hub/fitness-hub-app && ../fitness-hub-api/node_modules/.bin/wrangler pages deploy public --project-name bruno-fitness-hub
```

---

## 3. What is built (Stages 0–4 complete)

**Stage 0** — Node, GitHub, Wrangler, Worker deployed, D1 and R2 created.
**Stage 1** — Shared-secret auth (`safeEqual`, constant-time), six core tables via migrations.
**Stage 2A** — `POST /ingest/raw` stores the raw payload in R2 *before* parsing.
**Stage 2B** — Full Health Auto Export parser.
**Stage 3** — Seven years merged from three sources into D1 and verified.
**Stage 4** — Read/write API, seven-tab front end on Pages, dietary routing, data corrections.

### Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | Open, no auth. Also used by the app to prove the URL is the Worker. |
| `POST /ingest/raw` | Store + parse a payload. |
| `POST /ingest/replay?key=…` | Re-parse a stored R2 payload after a parser fix. |
| `GET /ingest/list` | 20 most recent batches. **Caps at 20.** |
| `GET /data/summary` | Row counts by metric, source and date range. |
| `GET /api/today?date=` | One round trip for the whole Hub screen. |
| `GET /api/plan?from=&to=` | Prescribed sessions, exercises, and resolved nutrition targets. |
| `GET /api/days?from=&to=` | `v_daily` rows over a range. |
| `GET /api/runs?from=&to=` | `v_run_readiness` plus the live-computed race spike. |
| `GET /api/targets?date=&day_type=` | Day-type-aware targets with explicit fallback. |
| `GET /api/goals?date=` | Goals with current values computed, never stored. |
| `GET /api/photos` | Photo list with dates and views parsed from keys. |
| `GET /api/photo?key=` | Streams one image from R2. |
| `POST /api/log` | Daily check-in. Validates, upserts, idempotent. |

**CORS:** origins allowlisted (`bruno-fitness-hub.pages.dev`, `*.bruno-fitness-hub.pages.dev`,
localhost:8788). Preflight is answered **above** the auth gate — `OPTIONS` carries no
`Authorization` header, so checking auth first would 401 it and the real request would never fire.

---

## 4. Schema

**Tables:** `settings`, `ingest_batches`, `body_measurements`, `health_metrics`, `workouts`,
`workout_heart_rate`, `daily_log`, `nutrition_intake`, `nutrition_targets`, `phases`,
`plan_sessions`, `plan_exercises`, `goals`, `d1_migrations`.

**Views:** `v_daily`, `v_weekly`, `v_daily_weight`, `v_daily_intake`, `v_body_composition`,
`v_capture_rate`, `v_run_readiness`.

### Design rules baked into the schema

- **Two timestamps per event.** `occurred_at` (UTC) and `local_date` (Sydney).
- **Nothing is deleted.** `deleted_at`, or `notes LIKE 'superseded%'`.
- **Large binaries live in R2**, not D1.
- **Every row carries `source`.** Views apply precedence.
- **Ratings run 1 = bad, 5 = good**, including fatigue, soreness and stress.
- **`aggregation`** records whether a health metric is a raw point or a daily total.

### Source precedence — established, worth not rediscovering

| Data | Order |
|---|---|
| Strength workouts | `hevy` > `health_auto_export` > `apple_health_xml` |
| Runs | `health_auto_export` > `apple_health_xml` > `strava` |
| Weight | `Withings` > `coach_tracker` > `v2_sheet` > everything else (incl. `app`) |
| Intake | `Cronometer` > `coach_tracker` > everything else |
| Steps / active energy | **No precedence rule** — `v_daily` takes the MAX across sources |

### Migrations 0001–0016

0001 core tables · 0002 `r2_key` · 0003 `source` in metric key · 0004 history tables + views ·
0005 exclude superseded · 0006 repair 0004 · 0007 workout volume · 0008 body-fat ×100 ·
0009 race settings · 0010 running views · 0011 body-fat estimator (**dropped in 0012**) ·
0012 `started_local`, HAE-vs-XML dedupe · 0013 nutrition targets ·
**0014 `plan_sessions` + `plan_exercises`** · **0015 supersede 16 Strava runs** · **0016 `goals`**

---

## 5. Data currently held

| Table | Rows |
|---|---|
| `body_measurements` | 2,468 |
| `health_metrics` | 23,635 |
| `workouts` | 3,267 |
| `workout_heart_rate` | 3,614 |
| `ingest_batches` | 77 |
| `plan_sessions` | 10 (13–22 Aug) |
| `goals` | 10 |

---

## 6. Hard-won facts — do not re-derive

### Tooling

- **Always run wrangler from `fitness-hub-api/`.** From anywhere else `npx` downloads the newest
  version, which keeps credentials in a *different file* and will demand a fresh login. This cost
  an hour.
- **`wrangler whoami` succeeding does not mean D1 access works.** It only exercises `account:read`.
  An expired token passes `whoami` and fails every D1 call with code 7403. Fix: `wrangler login`.
- **`wrangler pages deploy` prompts on first run** for a project that does not exist. Pasting the
  next command answers the prompt silently.
- **A Pages project name is globally unique** across all of Cloudflare, not just this account.
- **The deployment-specific URL (`<hash>.bruno-fitness-hub.pages.dev`) never updates.** Install and
  bookmark the bare `bruno-fitness-hub.pages.dev` or no future deploy reaches the phone.

### Health Auto Export

- Two automations: Health Metrics and Workouts are separate data types.
- Export Version **2**. Every datapoint carries `source`.
- **HAE now emits a pipe-joined source for merged devices**: `Bruno's Apple Watch|iPhone de Bruno`,
  with non-integer values. Undocumented. Store it, never match on it, round for display.
- **`duration` is in seconds. `active_energy` arrives in kJ. `dietary_energy` also arrives in kJ**
  — the parser relabels it `kcal` after converting, so querying `health_metrics.units` shows the
  *output* unit, not the input. This caused a wrong conclusion once.
- Dietary metric names confirmed against real payloads: `dietary_energy`, `protein`,
  `carbohydrates`, `total_fat`, `dietary_sugar`, `sodium`. Source string is `Cronometer`.
  **Fibre and water are not enabled** and their names are unverified.
- Phone cannot sync while locked. Freshness thresholds 36 h / 72 h.

### Data sources

- **Strava is downstream of Apple Health**, via auto-export from the Apple workout app. It is never
  an independent record. All 16 Strava runs were one-day-offset duplicates; 12 had no duration at
  all. Superseded in 0015. This had been inflating April–June weekly volume by up to 31 km.
- **Withings and Zepp Life disagree by ~9 percentage points** on body fat. Clean device boundary at
  1 March 2026. Never plot across it.
- Withings capture rate dropped sharply from July. **Batteries still not changed.**
- **Body-fat interpolation was tried and failed** (MAE 1.74 pp). Do not retry.
- **Body-fat estimation from photographs was rejected.** Relative comparison only.

### Queries and code

- **`v_daily`'s nutrition join is hardcoded to `day_type='default'`.** It can never show a rest,
  training, long-run or race target. Anything day-type-aware must query `nutrition_targets`
  directly — that is what `/api/targets` and `resolveTargets()` exist for.
- **`v_daily` only returns dates that already have data.** Today frequently has no row. Future
  dates never do.
- **D1: `prepare()` takes the SQL and nothing else.** Passing a bind value as a second argument
  throws "Wrong number of parameter bindings" at runtime only. Always `.prepare(sql).bind(...)`.
- **Testing SQL is not testing the endpoint.** The goals bug passed every direct-database test and
  failed on every real request.

### Shell and testing

- **`set -o pipefail` plus `grep -q` on a large input is a race.** `grep -q` closes the pipe on
  match; if the writer is still going it takes SIGPIPE and the pipeline returns 141, so a
  *successful* match reports failure. Intermittent, and only on inputs above the 64 KB pipe
  buffer. Use `grep -q pattern <<< "$var"`.
- **A test that can only pass is not a test.** Three front-end checks were "grep finds nothing",
  which passed happily against output that was never readable.
- **A fixture that drifts from the API tests a world that does not exist.** `fixtures.py` carried a
  hand-typed three-key `settings` stub. The Worker gained four body-fat calibration keys; the stub
  did not, so `bfFactor()` was null throughout the suite and the conversion path — the whole point
  of migrations 0021/0022 — was never once exercised. Two labelling checks "passed" only because
  no conversion ever happened. The fixture now reads settings from the database, and
  `render-assert.js` compares its key list against the Worker's `settings:` block.
- **`fixtures.py` locates the database relative to itself**, not `~/Documents`. The hardcoded home
  path resolved on one machine only.
- **A class-name check cannot catch a bad class *pair*.** `.card.tap` was dead — nothing in this app
  carries both — yet every check passed, because "card" and "tap" each appear somewhere. Catching
  that automatically needs a real DOM plus render coverage of every state; the attempt reported
  eleven live selectors as dead and was removed rather than papered over with an allowlist.
- **`transform-origin` belongs on the element, not inside `@keyframes`.** In a keyframe it is an
  animated property in its own right and does not hold, so a bar scales from its middle.
- **An exit animation makes hiding asynchronous.** Anything that reopens within the timer window
  must cancel it, or the pending callback closes the dialog that just opened.

---

## 7. Working rules

**From Bruno, non-negotiable:**
- **No fabricated data, ever.** Gaps stay gaps. Never interpolate, never guess a value.
- **Source and verify every claim.** Label unverified as unverified.
- **Correct mistakes directly**, state what was wrong before revising, no hedging.
- **Ground training advice in published evidence**, and say where the evidence is thin.

**Learned during the build:**
- **Local before remote, always** — but *verify the promotion happened*. Migrations 0015 and 0016
  were applied locally, verified, and never promoted; the Goals tab shipped broken as a result.
- **Never edit an applied migration.** Write a new one.
- **D1 can report a migration as applied when it created nothing.** Verify objects exist.
- **One command at a time when a prompt is involved.**
- **Long pastes fail in macOS Terminal.** Use `touch file && open -e file`.
- Bruno may report "nothing happens" when a command is merely slow.

**Testing — two layers.**

*Live, against the deployed stack:* `~/Desktop/audit.sh` (46 checks — auth, robustness,
idempotency, timezone, integrity, pipeline, schema parity, source control) and
`scripts/audit-stage4.sh` (51 checks — read API, data correctness, write API, CORS, front end, v2
isolation). As at 12 Aug: **97 passing, 0 failing.** `audit.sh` still lives on the Desktop, outside
version control — worth moving into `scripts/`.

*Offline, against the local D1 copy:* `bash fitness-hub-app/test/run.sh` — extracts the app's script
and runs every render function in a headless DOM against real data, then asserts on the output.
33 render + 72 assert + 51 theme/accessibility = **156 checks, 0 failing** as at 14 Aug. Needs
`npx wrangler d1 migrations apply fitness-hub-db --local` to have been run at least once.

Neither layer can see motion. Animation is the one thing that looks finished while being wrong,
because nothing about it throws — the suite checks that timings come from tokens, that
`prefers-reduced-motion` disables everything, that entrances are keyed to a tab change rather than
to rendering, and that keyframes touch only composited properties. It cannot check whether any of
it looks right. That is a phone job.

---

## 8. Current nutrition and race plan

Targets in migration 0013, expiring **deliberately** on 22 Aug to force a review.

| Day type | kcal | P | C | F |
|---|---|---|---|---|
| rest (to 19 Aug) | 2,100 | 185 | 205 | 60 |
| training (to 19 Aug) | 2,400 | 185 | 280 | 60 |
| long_run (to 19 Aug) | 2,900 | 185 | 395 | 65 |
| 20–21 Aug carb load | 3,300 | 160 | 555 | 50 |
| 22 Aug race | 3,000 | 150 | 500 | 55 |

The 20–21 Aug rows are `day_type='default'` **only**, so a training day in that window falls back
and the app labels it "general target".

**Race:** 42.195 km, 22 Aug, sub-4 = 5:41/km. **Riegel projects 3h55–4h01** across every logged run
of 15 km or more — every projection is slower than target, and Riegel assumes a distance-adequate
base which is absent.

**Distance spike: +83%**, against the longest run in the 30 days before race day — 23.02 km on
1 August. *The earlier +32% figure in the Stage 3 handover was wrong*: it used the 12 July 32 km
run, which falls outside the window. The app computes this live from `v_run_readiness` so it
cannot go stale again.

**Fuelling: 65 g/h**, a gel every ~20 min, Coles Perform Elite (~23.5 g carbs). Not 90 g/h — gut
adaptation takes 6–12 weeks. Max ~3 caffeinated gels. Water 400–800 ml/h, drink to thirst.
**Unverified: sodium content of the gels.**

**The ten days to the race** are in `plan_sessions` and `docs/10-day-plan-to-42km.md`. Rehearsal
**Sat 15 Aug, 26–28 km** — revised down from 28–30 because every option from 23 to 30 km lands in
the same BJSM injury band, so the extra distance buys no measurable risk reduction. Last
lower-body session was 12 Aug; upper body only from there.

**Observed max HR is 192 bpm** in runs, not the 184 previously recorded. Zones are Karvonen from
192 and resting ~59, labelled provisional.

---

## 9. Open items

**Needs Bruno**
- Sodium content of the gels — read the packet before the 15th.
- Enable **fibre** in HAE. The carb load calls for low fibre and it cannot be tracked otherwise.
- Upload the photos: `scripts/upload-photos.sh ~/Documents/Fitness/fitness-hub/01-photos`
  (dry run by default; verify the single-file `wrangler r2 object put` command works first).
- Confirm the app installs and runs **offline** on the phone — gear icon → Offline support.
- Nutrition targets and goals after 22 Aug — all expire, deliberately.
- Whether to change the Withings batteries.

**Decided, not built**
- Route data: enabled in HAE and parsing fine, but `route_r2_key` is never populated, 0 of 312.
  No per-km splits or maps until it is. The app shows this as an explicit absence.
- `/ingest/list` caps at 20 rows.
- 12 orphaned dietary rows remain in `health_metrics` from before the routing change. Nothing
  reads them.
- The standing Saturday session is unknown to v3.

**Deliberately deferred**
- Secret rotation — declined. The secret has appeared in chat logs and now lives in browser
  localStorage on the phone.
- v2 Sheet plan tabs not imported.
- Hevy API integration — Stage 7. No per-exercise load history until then.

---

## 10. Next

**Stage 5** running analysis, **Stage 6** photos beyond the basic comparison, **Stage 7** Hevy.

Immediately after 22 August: build the next training program, set new nutrition targets and goals
(all expire on the 23rd by design), and decide whether v2 can be switched off.
