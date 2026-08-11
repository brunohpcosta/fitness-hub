-- Migration 0007 — the three ALTER TABLE statements from 0004 that never
-- reached remote. Applied to remote ONLY; local already has these columns.
ALTER TABLE workouts ADD COLUMN total_volume_kg REAL;
ALTER TABLE workouts ADD COLUMN exercise_count INTEGER;
ALTER TABLE workouts ADD COLUMN set_count INTEGER;
