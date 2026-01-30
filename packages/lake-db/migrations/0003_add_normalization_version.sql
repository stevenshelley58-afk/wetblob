-- Add normalization_version column to runs table for lineage tracking

-- Add column as nullable first
ALTER TABLE runs ADD COLUMN IF NOT EXISTS normalization_version TEXT;

-- Backfill existing rows with default value
UPDATE runs SET normalization_version = 'v1' WHERE normalization_version IS NULL;

-- Make it NOT NULL for forward safety
ALTER TABLE runs ALTER COLUMN normalization_version SET NOT NULL;

-- Add collector_version for symmetry (optional but useful)
ALTER TABLE runs ADD COLUMN IF NOT EXISTS collector_version TEXT;

-- Backfill collector_version
UPDATE runs SET collector_version = 'unknown' WHERE collector_version IS NULL;
