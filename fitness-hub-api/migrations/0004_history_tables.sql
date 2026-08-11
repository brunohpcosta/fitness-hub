-- Migration 0004 — history tables
--
-- Creates everything the historical import needs, plus views that make the
-- merged data usable for analysis without writing joins by hand.
--
-- Design notes:
--  * nutrition_intake is WIDE (one row per day) rather than long (one row per
--    nutrient). You always want a whole day's macros together, and it is eight
--    times fewer rows.
--  * Every historical table carries `source`, so the same day can hold a
--    Withings reading and a hand-typed one without either being destroyed.
--    Views apply a precedence order to pick one for display.
--  * Ratings all run 1 = bad, 5 = good. Sources that ran the other way are
--    inverted on import, never stored raw.

-- ─────────────────────────────────────────────────────────────
-- daily_log — the manual daily entry
-- ─────────────────────────────────────────────────────────────
CREATE TABLE daily_log (
  local_date        TEXT PRIMARY KEY,

  -- Current form (six ratings plus hours)
  hours_slept       REAL    CHECK (hours_slept BETWEEN 0 AND 16),
  sleep_quality     INTEGER CHECK (sleep_quality BETWEEN 1 AND 5),
  fatigue           INTEGER CHECK (fatigue BETWEEN 1 AND 5),
  soreness          INTEGER CHECK (soreness BETWEEN 1 AND 5),
  stress            INTEGER CHECK (stress BETWEEN 1 AND 5),
  session_effort    INTEGER CHECK (session_effort BETWEEN 1 AND 5),
  notes             TEXT,

  -- Historical only. Not asked for by the current form; preserved because
  -- roughly 300 days of them exist across two earlier tracking systems.
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

-- ─────────────────────────────────────────────────────────────
-- nutrition_intake — what was actually eaten, one row per day per source
-- ─────────────────────────────────────────────────────────────
CREATE TABLE nutrition_intake (
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

CREATE INDEX idx_intake_date ON nutrition_intake(local_date DESC);

-- ─────────────────────────────────────────────────────────────
-- nutrition_targets — what was being aimed for, effective-dated
-- ─────────────────────────────────────────────────────────────
CREATE TABLE nutrition_targets (
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
  -- The rule, not just today's number. "2.3 g per kg bodyweight" survives a
  -- weight change; "180 g" does not.
  protein_basis       TEXT CHECK (protein_basis IN ('g_per_kg_bodyweight','g_per_kg_ffm','absolute')),
  protein_basis_value REAL,
  fat_floor_basis     TEXT CHECK (fat_floor_basis IN ('grams','pct_energy')),
  fat_floor_value     REAL,
  source              TEXT NOT NULL,
  note                TEXT,
  UNIQUE (effective_from, day_type, source)
);

-- ─────────────────────────────────────────────────────────────
-- phases — training and nutrition blocks
-- ─────────────────────────────────────────────────────────────
CREATE TABLE phases (
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

-- ─────────────────────────────────────────────────────────────
-- workouts — columns the Hevy export provides that HAE does not
-- ─────────────────────────────────────────────────────────────
ALTER TABLE workouts ADD COLUMN total_volume_kg REAL;
ALTER TABLE workouts ADD COLUMN exercise_count INTEGER;
ALTER TABLE workouts ADD COLUMN set_count INTEGER;

-- ─────────────────────────────────────────────────────────────
-- Views — the merged data, ready to query
-- ─────────────────────────────────────────────────────────────

-- One weight per day, best available source.
-- Withings beats a hand-typed transcription of a Withings reading.
CREATE VIEW v_daily_weight AS
SELECT b.local_date,
       (SELECT b2.value FROM body_measurements b2
         WHERE b2.metric = 'weight' AND b2.local_date = b.local_date
           AND b2.deleted_at IS NULL
         ORDER BY CASE b2.source
                    WHEN 'Withings'      THEN 1
                    WHEN 'coach_tracker' THEN 2
                    WHEN 'v2_sheet'      THEN 3
                    ELSE 4 END, b2.occurred_at
         LIMIT 1) AS weight_kg,
       (SELECT b3.source FROM body_measurements b3
         WHERE b3.metric = 'weight' AND b3.local_date = b.local_date
           AND b3.deleted_at IS NULL
         ORDER BY CASE b3.source
                    WHEN 'Withings'      THEN 1
                    WHEN 'coach_tracker' THEN 2
                    WHEN 'v2_sheet'      THEN 3
                    ELSE 4 END, b3.occurred_at
         LIMIT 1) AS source
FROM body_measurements b
WHERE b.metric = 'weight' AND b.deleted_at IS NULL
GROUP BY b.local_date;

-- One intake row per day, preferring the app that actually logged food.
CREATE VIEW v_daily_intake AS
SELECT local_date,
       energy_kcal, protein_g, carbs_g, fat_g,
       fat_saturated_g, fibre_g, sugar_g, sodium_mg, source
FROM nutrition_intake n
WHERE source = (SELECT n2.source FROM nutrition_intake n2
                 WHERE n2.local_date = n.local_date
                 ORDER BY CASE n2.source
                            WHEN 'Cronometer'    THEN 1
                            WHEN 'coach_tracker' THEN 2
                            ELSE 3 END
                 LIMIT 1);

-- The analysis table: one row per day, everything joined.
-- This is what a trend chart or a check-in should read from.
CREATE VIEW v_daily AS
SELECT d.local_date,
       w.weight_kg,
       w.source AS weight_source,
       (SELECT value FROM body_measurements
         WHERE metric = 'body_fat_pct' AND local_date = d.local_date
           AND deleted_at IS NULL ORDER BY occurred_at LIMIT 1) AS body_fat_pct,
       (SELECT value FROM body_measurements
         WHERE metric = 'lean_mass' AND local_date = d.local_date
           AND deleted_at IS NULL ORDER BY occurred_at LIMIT 1) AS lean_mass_kg,
       (SELECT value FROM health_metrics
         WHERE metric_name = 'resting_heart_rate' AND local_date = d.local_date
         ORDER BY occurred_at LIMIT 1) AS resting_hr,
       (SELECT AVG(value) FROM health_metrics
         WHERE metric_name = 'heart_rate_variability' AND local_date = d.local_date) AS hrv_ms,
       (SELECT value FROM health_metrics
         WHERE metric_name = 'step_count' AND local_date = d.local_date
         ORDER BY value DESC LIMIT 1) AS steps,
       (SELECT value FROM health_metrics
         WHERE metric_name = 'active_energy' AND local_date = d.local_date
         ORDER BY value DESC LIMIT 1) AS active_kcal,
       i.energy_kcal, i.protein_g, i.carbs_g, i.fat_g, i.fibre_g, i.sodium_mg,
       t.energy_kcal AS target_kcal,
       t.protein_g   AS target_protein_g,
       t.carbs_g     AS target_carbs_g,
       t.fat_g       AS target_fat_g,
       l.hours_slept, l.fatigue, l.soreness, l.stress, l.sleep_quality,
       l.performance, l.strength_feel, l.hunger, l.cravings, l.libido,
       l.notes,
       (SELECT COUNT(*) FROM workouts
         WHERE local_date = d.local_date AND kind = 'strength' AND deleted_at IS NULL) AS strength_sessions,
       (SELECT SUM(distance_km) FROM workouts
         WHERE local_date = d.local_date AND kind = 'run' AND deleted_at IS NULL) AS run_km,
       p.name AS phase,
       p.goal AS phase_goal
FROM (SELECT DISTINCT local_date FROM body_measurements WHERE deleted_at IS NULL
      UNION SELECT DISTINCT local_date FROM health_metrics
      UNION SELECT DISTINCT local_date FROM workouts WHERE deleted_at IS NULL
      UNION SELECT DISTINCT local_date FROM nutrition_intake
      UNION SELECT local_date FROM daily_log) d
LEFT JOIN v_daily_weight w ON w.local_date = d.local_date
LEFT JOIN v_daily_intake  i ON i.local_date = d.local_date
LEFT JOIN daily_log       l ON l.local_date = d.local_date
LEFT JOIN nutrition_targets t
       ON t.day_type = 'default'
      AND d.local_date >= t.effective_from
      AND (t.effective_to IS NULL OR d.local_date <= t.effective_to)
LEFT JOIN phases p
       ON d.local_date >= p.started_on
      AND (p.ended_on IS NULL OR d.local_date <= p.ended_on);

-- Weekly rollup — the level most decisions are actually made at.
CREATE VIEW v_weekly AS
SELECT DATE(local_date, 'weekday 0', '-6 days') AS week_start,
       COUNT(*)                       AS days,
       ROUND(AVG(weight_kg), 2)       AS avg_weight_kg,
       ROUND(AVG(body_fat_pct), 2)    AS avg_body_fat_pct,
       ROUND(AVG(energy_kcal))        AS avg_intake_kcal,
       ROUND(AVG(protein_g))          AS avg_protein_g,
       ROUND(AVG(target_kcal))        AS avg_target_kcal,
       ROUND(AVG(hours_slept), 1)     AS avg_sleep_h,
       ROUND(AVG(resting_hr), 1)      AS avg_resting_hr,
       ROUND(AVG(hrv_ms), 1)          AS avg_hrv_ms,
       ROUND(SUM(run_km), 1)          AS total_run_km,
       SUM(strength_sessions)         AS strength_sessions,
       ROUND(AVG(fatigue), 2)         AS avg_fatigue,
       ROUND(AVG(soreness), 2)        AS avg_soreness
FROM v_daily
GROUP BY week_start;

INSERT INTO settings (key, value) VALUES
  ('history_imported_from', '2019-01-01'),
  ('weight_source_priority', 'Withings,coach_tracker,v2_sheet'),
  ('intake_source_priority', 'Cronometer,coach_tracker');-- Migration number: 0004 	 2026-08-11T11:12:52.088Z
