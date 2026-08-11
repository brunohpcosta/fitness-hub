-- 0012 — timezone consistency, overlap dedupe, stale plan rows, test cleanup

-- 1. started_at means local time for XML rows and UTC for HAE rows.
--    Add an unambiguous local column. HAE began 8 Aug 2026 (AEST, +10),
--    so a fixed offset is correct for every current row.
ALTER TABLE workouts ADD COLUMN started_local TEXT;
UPDATE workouts SET started_local = started_at WHERE source <> 'health_auto_export';
UPDATE workouts SET started_local = datetime(started_at, '+10 hours') WHERE source = 'health_auto_export';

-- 2. Live ingest wins over the XML export where both cover a day.
UPDATE workouts SET notes = 'superseded by health_auto_export'
 WHERE source = 'apple_health_xml' AND deleted_at IS NULL
   AND (notes IS NULL OR notes NOT LIKE 'superseded%')
   AND EXISTS (SELECT 1 FROM workouts h WHERE h.source='health_auto_export'
                AND h.local_date = workouts.local_date AND h.kind = workouts.kind
                AND h.deleted_at IS NULL);

-- 3. Hevy wins over HAE for strength — it carries volume and set counts.
UPDATE workouts SET notes = 'superseded by Hevy'
 WHERE source = 'health_auto_export' AND kind = 'strength' AND deleted_at IS NULL
   AND (notes IS NULL OR notes NOT LIKE 'superseded%')
   AND EXISTS (SELECT 1 FROM workouts v WHERE v.source='hevy'
                AND v.local_date = workouts.local_date AND v.deleted_at IS NULL);

-- 4. Close off the old coach's plan at the last date there is evidence for it.
UPDATE nutrition_targets
   SET effective_to = (SELECT MAX(local_date) FROM daily_log WHERE source='coach_tracker')
 WHERE effective_to IS NULL AND source = 'coach_tracker';

UPDATE phases
   SET ended_on = (SELECT MAX(local_date) FROM daily_log WHERE source='coach_tracker')
 WHERE ended_on IS NULL AND source = 'coach_tracker';

-- 5. Current and next phase. Nutrition targets deliberately NOT set —
--    they are yours to decide, not mine to infer.
INSERT OR IGNORE INTO phases (name, goal, started_on, ended_on, target_weight_kg, source, notes) VALUES
  ('Marathon build + cut', 'fat_loss',  '2026-06-01', '2026-08-22', 76, 'app', 'Solo 42 km on 22 Aug'),
  ('Post-42 km',           'undecided', '2026-08-23', NULL,       NULL, 'app', 'Lean gain planned; targets to be set after the run');

-- 6. Remove the failed body-fat estimator (1.74pp mean error — see 0011).
DROP VIEW IF EXISTS v_body_fat_filled;

-- 7. Test and audit debris.
DELETE FROM ingest_batches
 WHERE session_id LIKE 'audit-%' OR session_id LIKE 'deploy-check%'
    OR session_id LIKE 'test-%'  OR session_id LIKE 'local-%';