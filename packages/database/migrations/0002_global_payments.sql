-- ShopGuard Migration 0002: Global payments & locale
-- Safe to run multiple times (IF NOT EXISTS / DO blocks)

-- 1. Change default timezone from Asia/Karachi to UTC
ALTER TABLE organizations ALTER COLUMN timezone SET DEFAULT 'UTC';

-- 2. Change default currency from PKR to USD
ALTER TABLE organizations ALTER COLUMN currency SET DEFAULT 'USD';

-- 3. Widen locale column for full BCP 47 codes (e.g. en-US, ja-JP, ar-AE)
ALTER TABLE organizations ALTER COLUMN locale TYPE VARCHAR(20);
ALTER TABLE organizations ALTER COLUMN locale SET DEFAULT 'en-US';

-- 4. Add payment enrichment columns to transactions
-- Safe: all nullable, no constraints on existing data
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS payment_channel TEXT,
  ADD COLUMN IF NOT EXISTS payment_provider TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS payment_last4 VARCHAR(4),
  ADD COLUMN IF NOT EXISTS payment_brand VARCHAR(50);

-- 5. Add indexes for new payment columns
CREATE INDEX IF NOT EXISTS idx_transactions_payment_channel
  ON transactions(organization_id, payment_channel);

CREATE INDEX IF NOT EXISTS idx_transactions_payment_provider
  ON transactions(organization_id, payment_provider);

-- 6. Add billing provider fields to subscriptions table
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS provider_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'stripe';

-- 7. Add unique index on provider_subscription_id for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_sub_id
  ON subscriptions(provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

-- 8. Create billing_events table for webhook idempotency
CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_event_id TEXT NOT NULL,        -- Stripe event ID (evt_xxx)
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload JSONB,
  UNIQUE(provider, provider_event_id)     -- Idempotency: no duplicate processing
);

CREATE INDEX IF NOT EXISTS idx_billing_events_org
  ON billing_events(organization_id);

CREATE INDEX IF NOT EXISTS idx_billing_events_provider_event
  ON billing_events(provider, provider_event_id);

-- 9. Add country to organizations if not present
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS country VARCHAR(2),       -- ISO 3166-1 alpha-2
  ADD COLUMN IF NOT EXISTS country_code VARCHAR(4);  -- Dialing code e.g. +1, +44, +92

-- Done
SELECT 'Migration 0002 complete' AS status;
