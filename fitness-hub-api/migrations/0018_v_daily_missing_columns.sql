-- 0018 — expose four daily_log columns that v_daily never selected.
--
-- session_effort, session_enjoyment, water_l and cardio_note were written
-- correctly by the check-in and were completely invisible to the app, because
-- the view did not carry them. Saving them appeared to do nothing: the value
-- went in, the form reloaded from v_daily, and the field came back empty.
--
-- Found by comparing PRAGMA table_info on daily_log against v_daily. Worth
-- keeping as a check — a column added to a table is not automatically visible
-- through a view built before it, and nothing warns you.
--
-- The rest of the definition is unchanged. DROP + CREATE because SQLite has no
-- ALTER VIEW; both sides end in the same state, which is the one case where
-- replacing a view rather than adding to it is safe.

DROP VIEW IF EXISTS v_daily;

CREATE VIEW v_daily AS
SELECT d.local_date,
       w.weight_kg,
       w.source AS weight_source,
       (SELECT value FROM body_measurements
         WHERE metric='body_fat_pct' AND local_date=d.local_date
           AND deleted_at IS NULL ORDER BY occurred_at LIMIT 1) AS body_fat_pct,
       (SELECT value FROM body_measurements
         WHERE metric='lean_mass' AND local_date=d.local_date
           AND deleted_at IS NULL ORDER BY occurred_at LIMIT 1) AS lean_mass_kg,
       (SELECT value FROM health_metrics
         WHERE metric_name='resting_heart_rate' AND local_date=d.local_date
         ORDER BY occurred_at LIMIT 1) AS resting_hr,
       (SELECT AVG(value) FROM health_metrics
         WHERE metric_name='heart_rate_variability' AND local_date=d.local_date) AS hrv_ms,
       (SELECT value FROM health_metrics
         WHERE metric_name='step_count' AND local_date=d.local_date
         ORDER BY value DESC LIMIT 1) AS steps,
       (SELECT value FROM health_metrics
         WHERE metric_name='active_energy' AND local_date=d.local_date
         ORDER BY value DESC LIMIT 1) AS active_kcal,
       i.energy_kcal, i.protein_g, i.carbs_g, i.fat_g, i.fibre_g, i.sodium_mg,
       t.energy_kcal AS target_kcal,
       t.protein_g   AS target_protein_g,
       t.carbs_g     AS target_carbs_g,
       t.fat_g       AS target_fat_g,
       l.hours_slept, l.fatigue, l.soreness, l.stress, l.sleep_quality,
       l.session_effort, l.session_enjoyment, l.water_l, l.cardio_note,
       l.performance, l.strength_feel, l.hunger, l.cravings, l.libido,
       l.notes,
       (SELECT COUNT(*) FROM workouts
         WHERE local_date=d.local_date AND kind='strength' AND deleted_at IS NULL
           AND (notes IS NULL OR notes NOT LIKE 'superseded%')) AS strength_sessions,
       (SELECT SUM(distance_km) FROM workouts
         WHERE local_date=d.local_date AND kind='run' AND deleted_at IS NULL
           AND (notes IS NULL OR notes NOT LIKE 'superseded%')) AS run_km,
       (SELECT SUM(total_volume_kg) FROM workouts
         WHERE local_date=d.local_date AND kind='strength' AND deleted_at IS NULL) AS volume_kg,
       p.name AS phase,
       p.goal AS phase_goal
FROM (SELECT DISTINCT local_date FROM body_measurements WHERE deleted_at IS NULL
      UNION SELECT DISTINCT local_date FROM health_metrics
      UNION SELECT DISTINCT local_date FROM workouts WHERE deleted_at IS NULL
      UNION SELECT DISTINCT local_date FROM nutrition_intake
      UNION SELECT local_date FROM daily_log) d
LEFT JOIN v_daily_weight w ON w.local_date=d.local_date
LEFT JOIN v_daily_intake  i ON i.local_date=d.local_date
LEFT JOIN daily_log       l ON l.local_date=d.local_date
LEFT JOIN nutrition_targets t
       ON t.day_type='default' AND d.local_date>=t.effective_from
      AND (t.effective_to IS NULL OR d.local_date<=t.effective_to)
LEFT JOIN phases p
       ON d.local_date>=p.started_on
      AND (p.ended_on IS NULL OR d.local_date<=p.ended_on);
