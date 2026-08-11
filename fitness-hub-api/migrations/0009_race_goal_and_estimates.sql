INSERT OR REPLACE INTO settings (key, value) VALUES
  ('race_date', '2026-08-22'),
  ('race_distance_km', '42.195'),
  ('race_target_minutes', '240'),
  ('race_label', 'Solo 42 km'),
  ('race_fuel_g_per_hour', '65'),
  ('race_gel_carbs_g', '23.5'),
  ('taper_starts', '2026-08-17');

ALTER TABLE body_measurements ADD COLUMN is_estimate INTEGER NOT NULL DEFAULT 0;

UPDATE body_measurements SET is_estimate = 1
 WHERE metric IN ('body_fat_pct','lean_mass','fat_mass','body_water_pct','muscle_mass','bone_mass');

INSERT OR REPLACE INTO settings (key, value) VALUES
  ('body_comp_is_estimate', 'true'),
  ('body_comp_rolling_days', '14'),
  ('body_comp_min_readings', '5');