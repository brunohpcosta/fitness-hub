-- Migration 0002 — record where each raw payload is stored in R2

ALTER TABLE ingest_batches ADD COLUMN r2_key TEXT;
ALTER TABLE ingest_batches ADD COLUMN content_type TEXT;-- Migration number: 0002 	 2026-08-11T08:26:49.472Z
