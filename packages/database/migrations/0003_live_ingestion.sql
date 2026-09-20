-- ShopGuard Migration 0003: Live data ingestion infrastructure
-- Safe to run multiple times (IF NOT EXISTS / DO blocks)
-- Does NOT delete any existing data

-- 1. Add data_source enum
DO $$ BEGIN
  CREATE TYPE data_source AS ENUM ('DEMO', 'CSV', 'API', 'WEBHOOK', 'TEST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Add data_source column to transactions
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS data_source data_source NOT NULL DEFAULT 'CSV';

-- Backfill: demo transactions → DEMO, existing csv imports → CSV
UPDATE transactions SET data_source = 'DEMO' WHERE is_demo = true AND data_source = 'CSV';

-- 3. Create api_keys table for machine-to-machine ingestion
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,            -- SHA-256 hash of the full secret key
  key_prefix VARCHAR(8) NOT NULL,    -- First 8 chars for identification: sg_XXXXX
  store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS api_keys_org_idx ON api_keys(organization_id);
CREATE INDEX IF NOT EXISTS api_keys_active_idx ON api_keys(organization_id, is_active);

-- 4. Unique constraint on transactions (org + provider + externalTransactionId)
--    Prevents duplicate ingestion from retrying POS systems
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_org_external_id
  ON transactions(organization_id, external_transaction_id)
  WHERE external_transaction_id IS NOT NULL;

-- 5. Add ingestion metrics table for monitoring
CREATE TABLE IF NOT EXISTS ingestion_stats (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  source TEXT NOT NULL DEFAULT 'api',   -- csv | api | webhook_square | etc.
  received INTEGER NOT NULL DEFAULT 0,
  accepted INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  validation_failures INTEGER NOT NULL DEFAULT 0,
  last_transaction_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, store_id, date, source)
);

CREATE INDEX IF NOT EXISTS ingestion_stats_org_date_idx
  ON ingestion_stats(organization_id, date DESC);

SELECT 'Migration 0003 complete' AS status;
