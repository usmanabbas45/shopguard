-- ShopGuard Migration 0004: Shopify integration tables
-- Safe to run multiple times (IF NOT EXISTS / DO blocks)

-- 1. Extend data_source enum to include SHOPIFY
DO $$ BEGIN
  ALTER TYPE data_source ADD VALUE IF NOT EXISTS 'SHOPIFY';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Shopify integrations table
CREATE TABLE IF NOT EXISTS shopify_integrations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
  shop_domain VARCHAR(255) NOT NULL,
  shopify_shop_id TEXT,
  access_token_encrypted TEXT NOT NULL,   -- AES-256-GCM, never plaintext
  scopes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | DISCONNECTED | ERROR
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uninstalled_at TIMESTAMPTZ,
  last_webhook_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  sync_status TEXT DEFAULT 'IDLE',        -- IDLE | RUNNING | COMPLETED | FAILED
  sync_started_at TIMESTAMPTZ,
  sync_completed_at TIMESTAMPTZ,
  sync_cursor TEXT,
  sync_error TEXT,
  sync_records_discovered INTEGER DEFAULT 0,
  sync_records_accepted INTEGER DEFAULT 0,
  sync_records_duplicates INTEGER DEFAULT 0,
  sync_records_rejected INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Unique constraint: one Shopify store per organization
CREATE UNIQUE INDEX IF NOT EXISTS shopify_integrations_org_domain_unique
  ON shopify_integrations(organization_id, shop_domain);

-- 4. Index for shop domain lookup (webhook routing)
CREATE INDEX IF NOT EXISTS shopify_integrations_shop_id_idx
  ON shopify_integrations(shopify_shop_id);

CREATE INDEX IF NOT EXISTS shopify_integrations_org_idx
  ON shopify_integrations(organization_id);

CREATE INDEX IF NOT EXISTS shopify_integrations_domain_idx
  ON shopify_integrations(shop_domain);

-- 5. Shopify webhook idempotency table
CREATE TABLE IF NOT EXISTS shopify_webhook_events (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES shopify_integrations(id) ON DELETE CASCADE,
  shop_domain VARCHAR(255) NOT NULL,
  shopify_webhook_id TEXT NOT NULL,       -- X-Shopify-Webhook-Id header
  topic TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Unique constraint for webhook idempotency
CREATE UNIQUE INDEX IF NOT EXISTS shopify_webhook_events_unique
  ON shopify_webhook_events(shop_domain, shopify_webhook_id);

CREATE INDEX IF NOT EXISTS shopify_webhook_events_integration_idx
  ON shopify_webhook_events(integration_id);

-- 7. Allow SHOPIFY as data_source on transactions
-- (The enum alter above handles this, column already exists from migration 0003)

SELECT 'Migration 0004 complete' AS status;
