-- 0014 — the prescribed plan, one row per calendar day.
--
-- Why dated rows rather than a day-of-week split:
--   1. A taper does not repeat. The ten days to 22 August are each different,
--      so a recurring weekly table would be the wrong shape for the only
--      period this needs to cover.
--   2. The current recurring split is not fully known — the Saturday session
--      lives in v2 and was never recorded here. Writing a guessed split would
--      put fabricated data in front of Bruno at 5am, which the working rules
--      forbid. Dated rows contain only what has actually been confirmed.
--
-- A recurring table can be added after 22 August alongside the next program.
--
-- Content source: docs/10-day-plan-to-42km.md, approved 12 Aug 2026.
-- Nothing here is deleted; deleted_at is used, consistent with every other table.

CREATE TABLE plan_sessions (
  local_date     TEXT PRIMARY KEY,
  day_label      TEXT NOT NULL,
  session_type   TEXT NOT NULL CHECK (session_type IN ('strength','run','both','rest','race')),
  is_rest        INTEGER NOT NULL DEFAULT 0 CHECK (is_rest IN (0,1)),
  run_km_min     REAL,
  run_km_max     REAL,
  run_pace_note  TEXT,
  run_hr_note    TEXT,
  gym_note       TEXT,
  fuel_note      TEXT,
  why            TEXT,
  source         TEXT NOT NULL DEFAULT 'app',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at     TEXT
);

CREATE TABLE plan_exercises (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  local_date  TEXT NOT NULL,
  ord         INTEGER NOT NULL,
  exercise    TEXT NOT NULL,
  sets_reps   TEXT NOT NULL,
  note        TEXT,
  source      TEXT NOT NULL DEFAULT 'app',
  deleted_at  TEXT,
  UNIQUE (local_date, ord)
);

CREATE INDEX idx_plan_exercises_date ON plan_exercises (local_date);

-- ── the ten days ───────────────────────────────────────────────────────────
-- Apostrophes are avoided throughout: the v2 import showed that quoting
-- corruption in this kind of text is silent and hard to spot afterwards.

INSERT INTO plan_sessions
  (local_date, day_label, session_type, is_rest,
   run_km_min, run_km_max, run_pace_note, run_hr_note, gym_note, fuel_note, why)
VALUES
  ('2026-08-13','Upper push + easy run','both',0,
   6,8,'6:00-6:15/km','Under 150','Upper body only. Half the usual sets at normal weights',NULL,
   'Keeps running frequency, which the taper evidence says to hold while volume falls. Legs stay untouched two days out from the rehearsal.'),

  ('2026-08-14','Rest','rest',1,
   NULL,NULL,NULL,NULL,NULL,NULL,
   'Nothing between you and Saturday.'),

  ('2026-08-15','Rehearsal long run','run',0,
   26,28,'6:00-6:10/km for the bulk, last 5 km at 5:41','Steady aerobic. If HR climbs past 160, slow down rather than push through',NULL,
   '65 g/h - one gel every 20 minutes. Same gels, same variants, same caffeine split as race day. 150-250 ml water with each',
   'The only dress rehearsal you get. Tests gut tolerance at 65 g/h under race intensity, and the discipline of starting slow. Revised down from 28-30 km: every option from 23 to 30 km lands in the same BJSM injury band, so the extra distance buys no measurable risk reduction while costing recovery you do not have.'),

  ('2026-08-16','Rest','rest',1,
   NULL,NULL,NULL,NULL,NULL,NULL,
   'Full rest. A walk if you want to move, nothing more.'),

  ('2026-08-17','Upper pull','strength',0,
   NULL,NULL,NULL,NULL,'Upper body only. Half the usual sets at normal weights',NULL,
   'Taper starts. Reduced volume at maintained load - a 14-day detraining period leaves maximal strength unchanged, so there is nothing to protect by lifting more.'),

  ('2026-08-18','Race-pace run','run',0,
   8,8,'3 km at 5:41/km inside an easy 8 km','160-168 during the block',NULL,
   'One serve before the block if the legs feel flat',
   'The intensity the taper keeps. Bosquet is explicit that intensity and frequency are held while volume falls 41-60 percent - dropping all fast running is the common taper mistake.'),

  ('2026-08-19','Optional light upper','strength',0,
   NULL,NULL,NULL,NULL,'Two exercises, two sets. Or skip entirely',NULL,
   'A judgement call. If you are undecided, skip it. Three days out there is nothing to gain.'),

  ('2026-08-20','Easy shakeout or rest','run',0,
   0,4,'Very easy, no target','Conversational',NULL,
   'Carb load begins - 7 to 8 g/kg, low fibre, low fat',
   'Carb loading starts today. Running is optional and exists only to keep the legs from going flat.'),

  ('2026-08-21','Rest','rest',1,
   NULL,NULL,NULL,NULL,NULL,NULL,
   'Complete rest. Legs up. Lay the gels out in order. Familiar high-carb dinner, nothing new, no alcohol.'),

  ('2026-08-22','42.195 km','race',0,
   42.195,42.195,'5:41/km for sub-4','Do not chase HR. Pace is not the limiter, the last 10 km is',NULL,
   '65 g/h - a gel every 20 minutes from the 20 minute mark. Water with every gel. Drink to thirst, 400-800 ml/h',
   'Start slower than feels right. The first 3 km should feel too easy.');

-- ── gym detail ─────────────────────────────────────────────────────────────
-- No tempo, no target RPE and no last-session history: Bruno does not log RIR
-- or RPE, and per-exercise history needs the Hevy integration, which is Stage 7.
-- Columns that cannot be filled honestly are left out rather than left empty.

INSERT INTO plan_exercises (local_date, ord, exercise, sets_reps, note) VALUES
  ('2026-08-13',1,'Machine chest press','3 x 8-10','Supported - low stabiliser cost'),
  ('2026-08-13',2,'Cable lateral raise','3 x 12-15','Light, no fatigue cost'),
  ('2026-08-13',3,'Seated DB shoulder press','2 x 8-10','Stop well short of failure'),
  ('2026-08-13',4,'Rope pushdown','2 x 12',NULL),

  ('2026-08-17',1,'Lat pulldown','3 x 8-10',NULL),
  ('2026-08-17',2,'Chest-supported row','3 x 10','Chest stays on the pad - no lower back loading'),
  ('2026-08-17',3,'Face pull','2 x 15',NULL),
  ('2026-08-17',4,'EZ curl','2 x 10',NULL),

  ('2026-08-19',1,'Machine chest press','2 x 8','Optional session'),
  ('2026-08-19',2,'Lat pulldown','2 x 8','Optional session');

-- ── settings ───────────────────────────────────────────────────────────────

INSERT OR REPLACE INTO settings (key, value) VALUES
  ('plan_source','docs/10-day-plan-to-42km.md'),
  ('plan_covers_from','2026-08-13'),
  ('plan_covers_to','2026-08-22'),
  ('plan_review_due','2026-08-23'),
  ('last_lower_body_session','2026-08-12'),
  ('rehearsal_date','2026-08-15'),
  ('rehearsal_km_min','26'),
  ('rehearsal_km_max','28');
