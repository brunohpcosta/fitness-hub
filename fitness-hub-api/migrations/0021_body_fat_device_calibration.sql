-- 0021 — express Zepp Life body fat on the Withings scale.
--
-- WHAT THIS IS NOT: a rewrite of recorded data. Every reading in
-- body_measurements stays exactly as the scale reported it. This adds a view
-- that expresses the old readings in the new scale's terms, flagged as
-- converted wherever it does so.
--
-- ── how the calibration was derived ────────────────────────────────────────
--
-- Load cells agree, so the disagreement is the impedance measurement alone:
--   Zepp Feb 2026     81.28 kg over 30 readings
--   Withings Mar 2026 81.02 kg over 34 readings      difference 0.26 kg
--
-- Body fat, three ways of estimating the offset:
--   same-day pair, 1 Mar 2026 (n=1)      -4.50 points
--   adjacent fortnight means             -7.61 points   95% CI -8.31 to -6.91
--   all-time means                       -8.99 points
--
-- The all-time figure is discarded: it spans six years across which real fat
-- loss occurred, so it measures the body changing, not the scale.
--
-- The same-day pair is discarded as an outlier. Withings has an SD of 1.42
-- over that fortnight (range 15.0 to 19.9) against Zepp's 0.48, and the single
-- overlap day used 19.9 — the highest Withings reading in the entire window.
-- Zepp is the more PRECISE instrument here; Withings is the one being kept for
-- accuracy, but it scatters three times as much.
--
-- Real change cannot account for the fortnight gap: weight moved 0.60 kg,
-- worth at most 0.74 points of body fat, against an observed 7.61.
--
-- ── why proportional rather than additive ──────────────────────────────────
--
-- Both models are anchored on the same overlap and agree there by
-- construction. They diverge away from it, and one overlap window cannot say
-- which is correct. Proportional is used because additive produces values that
-- are not credible at the bottom of the range:
--
--   Zepp 19.4%  ->  additive 11.8%   proportional 13.5%
--   Zepp 24.9%  ->  additive 17.3%   proportional 17.3%   (the anchor)
--   Zepp 29.6%  ->  additive 22.0%   proportional 20.5%
--
-- 64% of the 495 Zepp readings sit within +-3 points of the anchor, where the
-- two models differ by under half a point. The conversion is well supported
-- there and increasingly speculative towards the extremes.
--
-- ── the standing limitation ────────────────────────────────────────────────
--
-- One overlap window, one anchor point, n=1 on the same-day comparison. If a
-- second period of dual measurement ever exists, this should be re-derived.
-- Until then a converted value carries roughly +-0.7 points from the offset
-- itself, on top of the +-1.4 points of ordinary Withings scatter.

INSERT OR REPLACE INTO settings (key, value) VALUES
  ('bf_calibration_model',        'proportional'),
  ('bf_zepp_to_withings_factor',  '0.6943'),
  ('bf_zepp_to_withings_offset',  '-7.61'),
  ('bf_calibration_anchor_zepp',  '24.89'),
  ('bf_calibration_anchor_withings','17.28'),
  ('bf_calibration_ci_points',    '0.70'),
  ('bf_calibration_derived_on',   '2026-08-13'),
  ('bf_calibration_basis',
   'Zepp 15 readings 15 Feb - 1 Mar 2026 against Withings 18 readings 1 - 15 Mar 2026. Load cells agree to 0.26 kg over the same period, so the gap is impedance only. Single same-day pair rejected as an outlier: it used the highest Withings reading of the window.'),
  ('bf_calibration_caveat',
   'One anchor at 24.9% Zepp. Additive and proportional models agree there and diverge by up to 1.7 points at the extremes. Re-derive if a second dual-measurement period ever exists.'),
  ('body_fat_reference_device',   'Withings');

-- Body fat expressed on one scale, with provenance attached to every row.
-- Nothing here is stored; it is computed on read, so changing the calibration
-- changes every historical figure at once rather than leaving two generations
-- of converted numbers in the table.
CREATE VIEW v_body_fat_normalised AS
SELECT
  b.local_date,
  b.occurred_at,
  b.source AS device,
  ROUND(b.value, 2) AS raw_pct,
  ROUND(
    CASE
      WHEN b.source = 'Withings'  THEN b.value
      WHEN b.source = 'Zepp Life' THEN b.value *
        (SELECT CAST(value AS REAL) FROM settings WHERE key = 'bf_zepp_to_withings_factor')
      ELSE NULL
    END, 2) AS withings_pct,
  CASE WHEN b.source = 'Zepp Life' THEN 1 ELSE 0 END AS converted,
  -- How far this reading sits from the point the calibration was measured at.
  -- Beyond about 3 points the conversion is an extrapolation and should be
  -- read as such.
  CASE WHEN b.source = 'Zepp Life'
       THEN ROUND(ABS(b.value -
            (SELECT CAST(value AS REAL) FROM settings WHERE key='bf_calibration_anchor_zepp')), 1)
       ELSE 0 END AS points_from_anchor
FROM body_measurements b
WHERE b.metric = 'body_fat_pct'
  AND b.deleted_at IS NULL
  AND b.source IN ('Withings', 'Zepp Life');
