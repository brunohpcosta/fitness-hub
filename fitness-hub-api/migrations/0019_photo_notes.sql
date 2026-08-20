-- 0019 — notes against individual progress photos.
--
-- Deliberately holds NO body composition. LLM body-fat estimation from photos
-- was tried and rejected earlier in this project, and interpolation between
-- readings was backtested at 1.74 pp mean absolute error against a signal of
-- about 0.4 pp. Neither belongs in a database built to hold measured values.
--
-- What this stores instead is what a person can actually assert about a photo:
-- a written note, and whether the shot is comparable to others (same pose,
-- similar lighting, same framing). The second one matters more than it sounds
-- — a photo taken in different light will read as a body composition change
-- when nothing has changed at all.
--
-- Anything numeric about the body still comes from body_measurements.

CREATE TABLE photo_notes (
  local_date  TEXT NOT NULL,
  view        TEXT NOT NULL,
  note        TEXT,
  -- 1 comparable, 0 not, NULL not yet judged. Never inferred.
  comparable  INTEGER CHECK (comparable IN (0,1)),
  source      TEXT NOT NULL DEFAULT 'app',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (local_date, view)
);

CREATE INDEX idx_photo_notes_date ON photo_notes (local_date);

INSERT OR REPLACE INTO settings (key, value) VALUES
  ('photo_views', 'front,side,back'),
  ('photo_max_edge_px', '2000'),
  ('photo_policy',
   'No body composition is inferred from photographs. Numbers come from body_measurements only. Photos support relative judgement, not measurement.');
