-- 0016 — goals.
--
-- Each goal names the metric the app must compute to fill it in. Nothing here
-- stores a "current" value: a stored current would go stale silently, and a
-- stale number shown as live is the failure mode this project keeps guarding
-- against. metric_key tells the API how to derive it from real data, and where
-- it cannot be derived the app shows the goal as unavailable rather than zero.
--
-- Targets set by Bruno on 12 Aug 2026 except where noted:
--   weight 76 kg           — from settings.goal_weight_kg
--   body fat 14%           — chosen 12 Aug
--   lean mass 65.5 kg      — DERIVED as a floor just under the current 14-day
--                            average of 65.76. Not stated by Bruno; flagged
--                            for review on 23 August.
--   strength 5/wk, runs 3/wk — the standing program, from PROJECT-STATE. These
--                            deliberately read under during the taper, which is
--                            correct rather than a fault.
--   weekly km              — NO TARGET. Never stated, and meaningless mid-taper.
--                            Tracked only until the next program is built.
--   steps 10,000           — chosen 12 Aug. Below the current 12,687 average.
--   log 7/7, macros 6/7    — chosen 12 Aug.
--   sub-4 hours            — from settings.race_target_minutes.

CREATE TABLE goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category      TEXT NOT NULL CHECK (category IN ('body','training','habit','race')),
  name          TEXT NOT NULL,
  unit          TEXT,
  target_value  REAL,
  direction     TEXT NOT NULL CHECK (direction IN ('down','up','hold')),
  metric_key    TEXT NOT NULL,
  basis         TEXT,
  start_value   REAL,
  started_on    TEXT,
  target_date   TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  review_due    TEXT,
  source        TEXT NOT NULL DEFAULT 'app',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE INDEX idx_goals_active ON goals (active, sort_order);

INSERT INTO goals
  (category, name, unit, target_value, direction, metric_key, basis,
   start_value, started_on, target_date, sort_order, review_due)
VALUES
  ('body','Body weight','kg',76.0,'down','weight_7d_avg',
   '7-day average of the highest-precedence scale reading per day',
   81.4,'2026-06-01',NULL,1,'2026-08-23'),

  ('body','Body fat','%',14.0,'down','body_fat_14d_avg',
   '14-day rolling average, Withings only. Never mixed with Zepp Life — the two disagree by about 9 points on the same body',
   NULL,'2026-06-01',NULL,2,'2026-08-23'),

  ('body','Lean mass floor','kg',65.5,'hold','lean_mass_14d_avg',
   'A floor, not a target to exceed. Derived from the current 14-day average of 65.76, not stated. BIA lean mass swings about 1.4 kg day to day, so only the rolling average is meaningful',
   NULL,'2026-06-01',NULL,3,'2026-08-23'),

  ('training','Running distance','km/wk',NULL,'up','run_km_7d',
   'No target set. Meaningless during a taper — to be set with the next program',
   NULL,NULL,NULL,4,'2026-08-23'),

  ('training','Strength sessions','/wk',5,'up','strength_sessions_7d',
   'The standing program. Reads under during the taper by design',
   NULL,NULL,NULL,5,'2026-08-23'),

  ('training','Runs','/wk',3,'up','runs_7d',
   'Tuesday, Thursday, Sunday in the standing program',
   NULL,NULL,NULL,6,'2026-08-23'),

  ('habit','Daily steps','steps',10000,'up','steps_14d_avg',
   '14-day average. Current average is about 12,687, so this reads as met most days',
   NULL,NULL,NULL,7,'2026-08-23'),

  ('habit','Days logged','/wk',7,'up','days_logged_7d',
   'Days in the last 7 with a check-in recorded',
   NULL,NULL,NULL,8,'2026-08-23'),

  ('habit','Days on macros','/wk',6,'up','days_on_macros_7d',
   'Days in the last 7 with intake logged and energy within 10% of that day target',
   NULL,NULL,NULL,9,'2026-08-23'),

  ('race','Sub-4 hours','min',240,'down','race_projection',
   'Riegel projection from logged runs of 15 km or more. Assumes a distance-adequate base, which is absent — treat as a ceiling',
   NULL,NULL,'2026-08-22',10,'2026-08-23');

INSERT OR REPLACE INTO settings (key, value) VALUES
  ('goals_review_due','2026-08-23'),
  ('goals_note','Training and habit targets set 12 Aug 2026. Weekly km deliberately has no target until the post-race program.');
