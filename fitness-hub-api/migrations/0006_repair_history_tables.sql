-- Migration 0006 — repair
--
-- 0004 was recorded as applied on remote but created none of its objects.
-- Everything here uses IF NOT EXISTS, so it is safe on both databases:
-- local already has these and skips them; remote creates them.

CREATE TABLE IF NOT EXISTS daily_log (
  local_date        TEXT PRIMARY KEY,
  hours_slept       REAL    CHECK (hours_slept BETWEEN 0 AND 16),
  sleep_quality     INTEGER CHECK (sleep_quality BETWEEN 1 AND 5),
  fatigue           INTEGER CHECK (fatigue BETWEEN 1 AND 5),
  soreness          INTEGER CHECK (soreness BETWEEN 1 AND 5),
  stress            INTEGER CHECK (stress BETWEEN 1 AND 5),
  session_effort    INTEGER CHECK (session_effort BETWEEN 1 AND 5),
  notes             TEXT,
  performance       INTEGER CHECK (performance BETWEEN 1 AND 5),
  strength_feel     INTEGER CHECK (strength_feel BETWEEN 1 AND 5),
  session_enjoyment INTEGER CHECK (session_enjoyment BETWEEN 1 AND 5),
  hunger            INTEGER CHECK (hunger BETWEEN 1 AND 5),
  cravings          INTEGER CHECK (cravings BETWEEN 1 AND 5),
  libido            INTEGER CHECK (libido BETWEEN 1 AND 5),
  water_l           REAL,
  cardio_note       TEXT,
  source            TEXT NOT NULL DEFAULT 'app',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nutrition_intake (
  local_date      TEXT NOT NULL,
  source          TEXT NOT NULL,
  energy_kcal     REAL,
  protein_g       REAL,
  carbs_g         REAL,
  fat_g           REAL,
  fat_saturated_g REAL,
  fibre_g         REAL,
  sugar_g         REAL,
  sodium_mg       REAL,
  water_l         REAL,
  PRIMARY KEY (local_date, source)
);

CREATE INDEX IF NOT EXISTS idx_intake_date ON nutrition_intake(local_date DESC);

CREATE TABLE IF NOT EXISTS nutrition_targets (
  id                  INTEGER PRIMARY KEY,
  effective_from      TEXT NOT NULL,
  effective_to        TEXT,
  day_type            TEXT NOT NULL DEFAULT 'default'
                      CHECK (day_type IN ('default','training','rest','long_run','race')),
  energy_kcal         INTEGER,
  protein_g           INTEGER,
  carbs_g             INTEGER,
  fat_g               INTEGER,
  steps_target        INTEGER,
  protein_basis       TEXT CHECK (protein_basis IN ('g_per_kg_bodyweight','g_per_kg_ffm','absolute')),
  protein_basis_value REAL,
  fat_floor_basis     TEXT CHECK (fat_floor_basis IN ('grams','pct_energy')),
  fat_floor_value     REAL,
  source              TEXT NOT NULL,
  note                TEXT,
  UNIQUE (effective_from, day_type, source)
);

CREATE TABLE IF NOT EXISTS phases (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  goal             TEXT NOT NULL
                   CHECK (goal IN ('fat_loss','lean_gain','maintenance','endurance','undecided')),
  started_on       TEXT NOT NULL UNIQUE,
  ended_on         TEXT,
  target_weight_kg REAL,
  source           TEXT,
  notes            TEXT
);

CREATE VIEW IF NOT EXISTS v_daily_weight AS
SELECT b.local_date,
       (SELECT b2.value FROM body_measurements b2
         WHERE b2.metric='weight' AND b2.local_date=b.local_date AND b2.deleted_at IS NULL
         ORDER BY CASE b2.source WHEN 'Withings' THEN 1 WHEN 'coach_tracker' THEN 2
                                 WHEN 'v2_sheet' THEN 3 ELSE 4 END, b2.occurred_at
         LIMIT 1) AS weight_kg,
       (SELECT b3.source FROM body_measurements b3
         WHERE b3.metric='weight' AND b3.local_date=b.local_date AND b3.deleted_at IS NULL
         ORDER BY CASE b3.source WHEN 'Withings' THEN 1 WHEN 'coach_tracker' THEN 2
                                 WHEN 'v2_sheet' THEN 3 ELSE 4 END, b3.occurred_at
         LIMIT 1) AS source
FROM body_measurements b
WHERE b.metric='weight' AND b.deleted_at IS NULL
GROUP BY b.local_date;

CREATE VIEW IF NOT EXISTS v_daily_intake AS
SELECT local_date, energy_kcal, protein_g, carbs_g, fat_g,
       fat_saturated_g, fibre_g, sugar_g, sodium_mg, source
FROM nutrition_intake n
WHERE source = (SELECT n2.source FROM nutrition_intake n2
                 WHERE n2.local_date = n.local_date
                 ORDER BY CASE n2.source WHEN 'Cronometer' THEN 1
                                         WHEN 'coach_tracker' THEN 2 ELSE 3 END
                 LIMIT 1);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('history_imported_from', '2019-01-01'),
  ('weight_source_priority', 'Withings,coach_tracker,v2_sheet'),
  ('intake_source_priority', 'Cronometer,coach_tracker');-- Migration number: 0006 	 2026-08-11T12:24:09.274Z
