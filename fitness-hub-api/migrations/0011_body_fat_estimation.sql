CREATE VIEW v_body_fat_filled AS
WITH days AS (
  SELECT DISTINCT local_date, source FROM body_measurements
   WHERE metric='weight' AND deleted_at IS NULL AND source='Withings'
),
w AS (
  SELECT local_date, source, value AS weight_kg FROM body_measurements
   WHERE metric='weight' AND deleted_at IS NULL
),
lm AS (
  SELECT local_date, source, value AS lean_kg FROM body_measurements
   WHERE metric='lean_mass' AND deleted_at IS NULL
),
bf AS (
  SELECT local_date, source, value AS bf_pct FROM body_measurements
   WHERE metric='body_fat_pct' AND deleted_at IS NULL
)
SELECT d.local_date,
       d.source,
       ROUND(w.weight_kg,2)  AS weight_kg,
       ROUND(lm.lean_kg,2)   AS lean_measured,
       ROUND(bf.bf_pct,2)    AS bf_measured,
       (SELECT ROUND(AVG(l2.lean_kg),2) FROM lm l2
         WHERE l2.source=d.source
           AND l2.local_date >  DATE(d.local_date,'-14 days')
           AND l2.local_date <= DATE(d.local_date,'+14 days')) AS lean_window_avg,
       (SELECT COUNT(*) FROM lm l3
         WHERE l3.source=d.source
           AND l3.local_date >  DATE(d.local_date,'-14 days')
           AND l3.local_date <= DATE(d.local_date,'+14 days')) AS lean_readings,
       ROUND(100.0 * (w.weight_kg -
         (SELECT AVG(l4.lean_kg) FROM lm l4
           WHERE l4.source=d.source
             AND l4.local_date >  DATE(d.local_date,'-14 days')
             AND l4.local_date <= DATE(d.local_date,'+14 days')))
         / NULLIF(w.weight_kg,0), 2) AS bf_estimated,
       CASE WHEN bf.bf_pct IS NOT NULL THEN 'measured' ELSE 'estimated' END AS method
FROM days d
JOIN w  ON w.local_date=d.local_date  AND w.source=d.source
LEFT JOIN lm ON lm.local_date=d.local_date AND lm.source=d.source
LEFT JOIN bf ON bf.local_date=d.local_date AND bf.source=d.source;