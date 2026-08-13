-- 0017 — verified gel nutrition, read off the packet on 12 August 2026.
--
-- The sodium content of these gels had been flagged UNVERIFIED since the
-- fuelling plan was written. It is now known, and the answer changes the plan:
--
--   Green Apple / Cola   7.46 mg sodium per gel
--   Raspberry           15.4  mg sodium per gel  (sold as "double sodium")
--   All variants        23.8 g carbs, 101 kcal / 420 kJ, 9.38 g sugars
--
-- At 11 gels that is 82 mg of sodium across a four-hour race. Guidance is
-- 0.5-0.7 g per litre of fluid, and 400-800 ml/h over four hours is 1.6-3.2 L,
-- so the target is roughly 800-2,200 mg. The gels supply 4-10% of it.
--
-- Conclusion: a separate electrolyte source is required, not optional. This
-- was named as a contingency in the fuelling plan; it is now the plan.
--
-- Carbs corrected from the 23.5 g estimate to the labelled 23.8 g. The
-- difference is 3.3 g across the race — immaterial, but it is now measured
-- rather than assumed, which is the point.
--
-- STILL UNVERIFIED: caffeine. The label lists "Added Guarana" for the Cola
-- variant without a quantity. The 50 mg figure in the project notes has never
-- been confirmed against a packet.

INSERT OR REPLACE INTO settings (key, value) VALUES
  ('race_gel_carbs_g',        '23.8'),
  ('race_gel_sodium_mg',      '7.46'),
  ('race_gel_sodium_mg_high', '15.4'),
  ('race_gel_kcal',           '101'),
  ('race_gel_sugars_g',       '9.38'),
  ('race_gel_brand',          'Coles Perform Elite'),
  ('race_gel_verified_on',    '2026-08-12'),
  ('race_gel_caffeine_status','UNVERIFIED — label states Added Guarana for the Cola variant with no quantity'),
  ('race_sodium_target_mg_per_l', '600'),
  ('race_sodium_note',
   'Gels supply about 82 mg across the race against a target of 800-2200 mg. A separate electrolyte source is required. Test it on the 15 Aug rehearsal, not on race day.');
