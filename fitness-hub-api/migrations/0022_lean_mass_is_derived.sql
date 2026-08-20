-- 0022 — lean mass needs no calibration of its own, and deriving one would be
-- an error. This migration records why, and adds a view expressing the whole
-- body composition on one scale.
--
-- ── the finding ────────────────────────────────────────────────────────────
--
-- Lean mass is not an independent measurement on either scale. Both compute it
-- from weight and body fat and store the result:
--
--     lean = weight x (1 - body_fat_pct / 100)
--
-- Tested against every day where all three metrics exist:
--
--   Zepp Life   n=450   residual mean -0.002 kg  sd 0.036   99% within 0.05 kg
--   Withings    n=136   residual mean -0.001 kg  sd 0.041   95% within 0.05 kg
--
-- The identity holds to within rounding. There is one impedance measurement
-- behind these numbers, not two.
--
-- ── why a separate lean calibration would be wrong ─────────────────────────
--
-- Fitting an independent Zepp-to-Withings offset for lean mass would apply a
-- second correction to a quantity that already inherits the body-fat one. The
-- two would then be free to disagree, and lean + fat would stop summing to
-- weight — an internal contradiction the data does not contain.
--
-- So lean is converted by recomputing it from the converted body fat:
--
--     lean_ref = weight x (1 - (bf_zepp x factor) / 100)
--
-- ── validation ─────────────────────────────────────────────────────────────
--
-- Across the device changeover the converted series is continuous:
--   24 Feb - 1 Mar 2026  Zepp, converted      66.9 to 68.0 kg
--   2 - 8 Mar 2026       Withings, native     65.8 to 67.6 kg
--
-- And it behaves the way lean mass should — steadier than weight:
--   converted lean  62.3 to 73.0 kg   sd 2.79
--   weight          72.8 to 91.7 kg   sd 5.15
--   native Withings 63.8 to 73.7 kg   sd 2.00
--
-- Converting lifts the Zepp-era figures by 6.11 kg on average (4.29 to 8.32).
-- That is large, and it is the same correction already applied to body fat
-- expressed as mass rather than a percentage — not a second adjustment.

INSERT OR REPLACE INTO settings (key, value) VALUES
  ('lean_mass_is_derived', 'true'),
  ('lean_mass_derivation', 'weight * (1 - body_fat_pct/100), verified on 450 Zepp and 136 Withings days with residual sd under 0.05 kg'),
  ('lean_mass_calibration_policy',
   'No independent calibration. Lean is recomputed from the converted body fat so that lean + fat continues to sum to weight. Fitting a separate offset would double-count the correction.');

-- Whole body composition on the reference scale, provenance attached.
CREATE VIEW v_body_composition_normalised AS
SELECT
  w.local_date,
  w.source AS device,
  ROUND(w.value, 2) AS weight_kg,
  ROUND(f.value, 2) AS body_fat_raw_pct,
  ROUND(
    CASE WHEN w.source = 'Withings'  THEN f.value
         WHEN w.source = 'Zepp Life' THEN f.value *
           (SELECT CAST(value AS REAL) FROM settings WHERE key='bf_zepp_to_withings_factor')
    END, 2) AS body_fat_pct,
  ROUND(l.value, 2) AS lean_raw_kg,
  -- Recomputed, never separately calibrated.
  ROUND(
    CASE WHEN w.source = 'Withings'  THEN l.value
         WHEN w.source = 'Zepp Life' THEN w.value * (1 -
           (f.value * (SELECT CAST(value AS REAL) FROM settings WHERE key='bf_zepp_to_withings_factor')) / 100)
    END, 2) AS lean_kg,
  CASE WHEN w.source = 'Zepp Life' THEN 1 ELSE 0 END AS converted
FROM body_measurements w
JOIN body_measurements f
  ON f.local_date = w.local_date AND f.source = w.source
 AND f.metric = 'body_fat_pct' AND f.deleted_at IS NULL
JOIN body_measurements l
  ON l.local_date = w.local_date AND l.source = w.source
 AND l.metric = 'lean_mass' AND l.deleted_at IS NULL
WHERE w.metric = 'weight'
  AND w.deleted_at IS NULL
  AND w.source IN ('Withings', 'Zepp Life')
GROUP BY w.local_date, w.source;
