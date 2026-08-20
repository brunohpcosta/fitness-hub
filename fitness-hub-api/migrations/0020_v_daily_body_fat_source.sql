-- 0020 — expose which device recorded the body fat.
--
-- Without this the app cannot tell a real change from a change of scale, and
-- it was already getting it wrong: the photo comparison reported "body fat
-- 26.8% to 14.5%, same device only" for February 2025 against July 2026. That
-- straddles the Withings/Zepp Life boundary on 1 March 2026, and those two
-- disagreed by roughly 9 percentage points measuring the same body. Most of
-- that 12-point "improvement" was the scale changing, and the app asserted the
-- opposite.
--
-- The rule that body composition is never plotted across the device boundary
-- is only enforceable if the device is visible. Now it is.

DROP VIEW IF EXISTS v_daily;

CREATE VIEW v_daily AS
SELECT d.local_date,
       w.weight_kg,
       w.source AS weight_source,
       (SELECT value FROM body_measurements
         WHERE metric='body_fat_pct' AND local_date=d.local_date
           AND deleted_at IS NULL ORDER BY occurred_at LIMIT 1) AS body_fat_pct,
       (SELECT source FROM body_measurements
         WHERE metric='body_fat_pct' AND local_date=d.local_date
           AND deleted_at IS NULL ORDER BY occurred_at LIMIT 1) AS body_fat_source,
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
