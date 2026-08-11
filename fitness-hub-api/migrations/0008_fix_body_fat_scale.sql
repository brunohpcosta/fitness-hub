-- Migration 0008 — body fat imported from the Apple Health XML was stored as
-- a fraction (0.194) despite the unit attribute saying "%". Live ingest via
-- Health Auto Export is unaffected — it already arrives as 19.4.
--
-- Only values below 1 are touched, so this is safe to run twice.

UPDATE body_measurements
   SET value = value * 100
 WHERE metric = 'body_fat_pct'
   AND value < 1;
