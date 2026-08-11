-- Migration 0001 — core tables
-- Everything needed to receive data from Health Auto Export.

-- ─────────────────────────────────────────────────────────────
-- settings — configuration that shouldn't be hard-coded
-- ─────────────────────────────────────────────────────────────
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO settings (key, value) VALUES
  ('timezone',                 'Australia/Sydney'),
  ('freshness_warn_hours',     '36'),
  ('freshness_alert_hours',    '72'),
  ('goal_weight_kg',           '76'),
  ('schema_version',           '1');

-- ─────────────────────────────────────────────────────────────
-- ingest_batches — one row per delivery from your phone
-- ─────────────────────────────────────────────────────────────
CREATE TABLE ingest_batches (
  id              INTEGER PRIMARY KEY,
  session_id      TEXT NOT NULL UNIQUE,
  automation_id   TEXT,
  automation_name TEXT,
  received_at     TEXT NOT NULL DEFAULT (datetime('now')),
  byte_size       INTEGER,
  status          TEXT NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received','processed','failed','partial')),
  error_detail    TEXT
);

CREATE INDEX idx_ingest_received ON ingest_batches(received_at DESC);

-- ─────────────────────────────────────────────────────────────
-- body_measurements — weight, body fat, waist
-- ─────────────────────────────────────────────────────────────
CREATE TABLE body_measurements (
  id              INTEGER PRIMARY KEY,
  metric          TEXT NOT NULL
                  CHECK (metric IN ('weight','body_fat_pct','lean_mass','fat_mass',
                                    'waist','body_water_pct','muscle_mass','bone_mass')),
  value           REAL NOT NULL,
  units           TEXT NOT NULL,
  occurred_at     TEXT NOT NULL,
  local_date      TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'health_auto_export',
  entry_method    TEXT NOT NULL DEFAULT 'automatic'
                  CHECK (entry_method IN ('automatic','manual')),
  ingest_batch_id INTEGER REFERENCES ingest_batches(id),
  deleted_at      TEXT,
  UNIQUE (metric, occurred_at, source)
);

CREATE INDEX idx_body_metric_date ON body_measurements(metric, local_date DESC);

-- ─────────────────────────────────────────────────────────────
-- health_metrics — resting HR, HRV, steps, energy
-- ─────────────────────────────────────────────────────────────
CREATE TABLE health_metrics (
  id              INTEGER PRIMARY KEY,
  metric_name     TEXT NOT NULL,
  value           REAL,
  value_min       REAL,
  value_max       REAL,
  units           TEXT NOT NULL,
  occurred_at     TEXT NOT NULL,
  local_date      TEXT NOT NULL,
  ingest_batch_id INTEGER REFERENCES ingest_batches(id),
  UNIQUE (metric_name, occurred_at, units)
);

CREATE INDEX idx_health_metric_date ON health_metrics(metric_name, local_date DESC);

-- ─────────────────────────────────────────────────────────────
-- workouts — runs and gym sessions
-- ─────────────────────────────────────────────────────────────
CREATE TABLE workouts (
  id                  INTEGER PRIMARY KEY,
  kind                TEXT NOT NULL
                      CHECK (kind IN ('run','strength','walk','cycle','other')),
  started_at          TEXT NOT NULL,
  ended_at            TEXT,
  local_date          TEXT NOT NULL,
  duration_min        REAL,
  title               TEXT,

  distance_km         REAL,
  avg_pace_sec_per_km REAL,
  elevation_gain_m    REAL,
  avg_heart_rate      REAL,
  max_heart_rate      REAL,
  active_energy_kcal  REAL,
  temperature_c       REAL,
  humidity_pct        REAL,

  route_r2_key        TEXT,
  hae_workout_id      TEXT UNIQUE,
  hevy_workout_id     TEXT UNIQUE,
  source              TEXT NOT NULL,
  entry_method        TEXT NOT NULL DEFAULT 'automatic'
                      CHECK (entry_method IN ('automatic','manual')),
  notes               TEXT,
  ingest_batch_id     INTEGER REFERENCES ingest_batches(id),
  deleted_at          TEXT
);

CREATE INDEX idx_workouts_date ON workouts(local_date DESC);
CREATE INDEX idx_workouts_kind_date ON workouts(kind, local_date DESC);

-- ─────────────────────────────────────────────────────────────
-- workout_heart_rate — minute-by-minute HR through a session
-- ─────────────────────────────────────────────────────────────
CREATE TABLE workout_heart_rate (
  id          INTEGER PRIMARY KEY,
  workout_id  INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  occurred_at TEXT NOT NULL,
  hr_min      REAL,
  hr_avg      REAL NOT NULL,
  hr_max      REAL,
  UNIQUE (workout_id, occurred_at)
);

CREATE INDEX idx_whr_workout ON workout_heart_rate(workout_id, occurred_at);-- Migration number: 0001 	 2026-08-11T07:55:14.035Z
