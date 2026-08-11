-- 0013 — current nutrition targets. Bruno's own, superseding the coach block.
-- Deliberately expire on 22 Aug so they must be reviewed, not inherited.

INSERT INTO nutrition_targets
  (effective_from, effective_to, day_type, energy_kcal, protein_g, carbs_g, fat_g,
   protein_basis, protein_basis_value, fat_floor_basis, fat_floor_value, source, note)
VALUES
  ('2026-08-12','2026-08-19','rest',      2100, 185, 205, 60,
   'g_per_kg_bodyweight', 2.34, 'pct_energy', 20, 'app', 'Rest or single light session'),
  ('2026-08-12','2026-08-19','training',  2400, 185, 280, 60,
   'g_per_kg_bodyweight', 2.34, 'pct_energy', 20, 'app', 'Lift plus easy run'),
  ('2026-08-12','2026-08-19','long_run',  2900, 185, 395, 65,
   'g_per_kg_bodyweight', 2.34, 'pct_energy', 20, 'app', '20 km+ — 5.0 g/kg carbs'),
  ('2026-08-12','2026-08-19','default',   2400, 185, 280, 60,
   'g_per_kg_bodyweight', 2.34, 'pct_energy', 20, 'app', 'Maintenance. No deficit before the 42 km'),
  ('2026-08-20','2026-08-21','default',   3300, 160, 555, 50,
   'g_per_kg_bodyweight', 2.03, 'pct_energy', 14, 'app', 'Carb load 7 g/kg. Low fibre, low fat'),
  ('2026-08-22','2026-08-22','race',      3000, 150, 500, 55,
   'g_per_kg_bodyweight', 1.90, 'pct_energy', 16, 'app', 'Race day incl. ~265 g in-run carbs');

INSERT OR REPLACE INTO settings (key, value) VALUES
  ('maintenance_kcal_estimate', '2200'),
  ('maintenance_basis', 'derived from -0.37 kg/wk vs 1664 kcal logged; logged intake likely under-reports'),
  ('targets_review_due', '2026-08-23');