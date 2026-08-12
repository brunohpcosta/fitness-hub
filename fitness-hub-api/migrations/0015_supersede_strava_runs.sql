-- 0015 — mark the duplicated Strava runs as superseded.
--
-- Why these are duplicates, established rather than assumed:
--   * All 16 Strava runs have an apple_health_xml twin exactly one day later.
--   * Distances differ by 0.00–0.05 km; where both carry a duration they agree
--     to within one minute.
--   * 12 of the 16 Strava rows have no duration and no pace at all.
--   * Bruno records runs in the Apple workout app, which exports automatically
--     to Strava. Strava is therefore downstream of Apple Health by definition —
--     a copy, never an independent measurement.
--
-- The one-day offset is the same UTC-versus-Sydney problem migration 0012
-- fixed for the HAE/XML overlap. It was never applied to Strava.
--
-- Effect: April–June weekly running volume falls by 4.6 to 31.1 km per week.
-- The June peak of 67–70 km/week was never real; the true peak is about 47 km.
--
-- Nothing is deleted. The rows stay and are flagged, which is how every other
-- supersede in this schema works, and every view already filters on the note.

UPDATE workouts
   SET notes = 'superseded by apple_health_xml'
 WHERE kind = 'run'
   AND source = 'strava'
   AND deleted_at IS NULL
   AND (notes IS NULL OR notes NOT LIKE 'superseded%')
   -- Deliberately conditional rather than a blanket update on source='strava'.
   -- A Strava run with no Apple Health twin would be the only record of that
   -- session, and must not be hidden.
   AND EXISTS (
     SELECT 1
       FROM workouts x
      WHERE x.kind = 'run'
        AND x.source = 'apple_health_xml'
        AND x.deleted_at IS NULL
        AND ABS(JULIANDAY(x.local_date) - JULIANDAY(workouts.local_date)) <= 1.5
        AND ABS(x.distance_km - workouts.distance_km) < 0.6
   );

-- Record the precedence so it does not have to be rediscovered.
INSERT OR REPLACE INTO settings (key, value) VALUES
  ('workout_source_precedence',
   'strength: hevy > health_auto_export > apple_health_xml; runs: health_auto_export > apple_health_xml > strava'),
  ('strava_status',
   'Downstream of Apple Health via auto-export. Never an independent source. Excluded 2026-08-12.');
