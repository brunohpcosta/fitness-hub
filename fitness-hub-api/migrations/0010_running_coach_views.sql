CREATE VIEW v_body_composition AS
SELECT b.local_date,
       b.source AS device,
       b.metric,
       ROUND(AVG(w.value), 2) AS rolling_avg,
       COUNT(w.value)         AS readings,
       CASE
         WHEN COUNT(w.value) >= 10 THEN 'good'
         WHEN COUNT(w.value) >= 5  THEN 'fair'
         WHEN COUNT(w.value) >= 2  THEN 'sparse'
         ELSE 'single_reading'
       END AS confidence,
       ROUND(MIN(w.value), 2) AS window_min,
       ROUND(MAX(w.value), 2) AS window_max
FROM body_measurements b
JOIN body_measurements w
  ON w.metric = b.metric
 AND w.source = b.source
 AND w.deleted_at IS NULL
 AND w.local_date <= b.local_date
 AND w.local_date >  DATE(b.local_date, '-14 days')
WHERE b.deleted_at IS NULL
  AND b.is_estimate = 1
GROUP BY b.local_date, b.source, b.metric;

CREATE VIEW v_capture_rate AS
SELECT strftime('%Y-%m', local_date) AS month,
       source,
       COUNT(DISTINCT CASE WHEN metric='weight' THEN local_date END) AS weight_days,
       COUNT(DISTINCT CASE WHEN metric='body_fat_pct' THEN local_date END) AS body_comp_days,
       ROUND(100.0 * COUNT(DISTINCT CASE WHEN metric='body_fat_pct' THEN local_date END)
                   / NULLIF(COUNT(DISTINCT CASE WHEN metric='weight' THEN local_date END), 0), 0)
         AS capture_pct
FROM body_measurements
WHERE deleted_at IS NULL
GROUP BY month, source
HAVING weight_days > 0;

CREATE VIEW v_run_readiness AS
SELECT w.local_date,
       ROUND(w.distance_km, 2) AS distance_km,
       ROUND(w.duration_min, 1) AS duration_min,
       ROUND(w.avg_pace_sec_per_km) AS pace_sec_per_km,
       CAST(w.avg_pace_sec_per_km/60 AS INT) || ':' ||
         printf('%02d', CAST(w.avg_pace_sec_per_km AS INT) % 60) AS pace,
       ROUND(w.avg_heart_rate) AS avg_hr,
       ROUND(w.max_heart_rate) AS max_hr,
       ROUND(w.temperature_c, 1) AS temp_c,
       (SELECT ROUND(MAX(p.distance_km), 2) FROM workouts p
         WHERE p.kind='run' AND p.deleted_at IS NULL
           AND p.local_date <  w.local_date
           AND p.local_date >= DATE(w.local_date, '-30 days')) AS longest_prior_30d,
       (SELECT ROUND(SUM(p.distance_km), 1) FROM workouts p
         WHERE p.kind='run' AND p.deleted_at IS NULL
           AND p.local_date <= w.local_date
           AND p.local_date >  DATE(w.local_date, '-7 days')) AS km_last_7d
FROM workouts w
WHERE w.kind = 'run'
  AND w.deleted_at IS NULL
  AND w.distance_km > 0
  AND (w.notes IS NULL OR w.notes NOT LIKE 'superseded%');