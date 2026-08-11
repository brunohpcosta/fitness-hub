-- Migration 0003 — add source to health_metrics and rebuild the unique constraint.
--
-- The real HAE payload carries a source field on every datapoint, which the
-- original schema assumed absent. Rebuilding is safe: the table is empty.

DROP INDEX IF EXISTS idx_health_metric_date;
DROP TABLE health_metrics;

CREATE TABLE health_metrics (
  id              INTEGER PRIMARY KEY,
  metric_name     TEXT NOT NULL,
  value           REAL,
  value_min       REAL,
  value_max       REAL,
  units           TEXT NOT NULL,
  occurred_at     TEXT NOT NULL,
  local_date      TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'unknown',
  aggregation     TEXT NOT NULL DEFAULT 'point'
                  CHECK (aggregation IN ('point','daily_total','daily_avg')),
  ingest_batch_id INTEGER REFERENCES ingest_batches(id),
  UNIQUE (metric_name, occurred_at, source)
);

CREATE INDEX idx_health_metric_date ON health_metrics(metric_name, local_date DESC);

-- Records which metrics get rolled up to one row per day rather than stored
-- point-by-point. Editable later without a schema change.
INSERT INTO settings (key, value) VALUES
  ('daily_total_metrics', 'step_count,active_energy'),
  ('energy_unit_display', 'kcal');
