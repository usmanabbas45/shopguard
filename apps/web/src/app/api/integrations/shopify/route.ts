/**
 * GET  /api/integrations/shopify  — Integration status (no secrets returned)
 * DELETE /api/integrations/shopify — Disconnect integration (OWNER/ADMIN only)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { shopifyIntegrations } from '@shopguard/database'
import { eq, and } from 'drizzle-orm'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()
  const [integration] = await db.select({
    id: shopifyIntegrations.id,
    shopDomain: shopifyIntegrations.shopDomain,
    status: shopifyIntegrations.status,
    scopes: shopifyIntegrations.scopes,
    installedAt: shopifyIntegrations.installedAt,
    uninstalledAt: shopifyIntegrations.uninstalledAt,
    lastWebhookAt: shopifyIntegrations.lastWebhookAt,
    lastSyncAt: shopifyIntegrations.lastSyncAt,
    syncStatus: shopifyIntegrations.syncStatus,
    syncStartedAt: shopifyIntegrations.syncStartedAt,
    syncCompletedAt: shopifyIntegrations.syncCompletedAt,
    syncError: shopifyIntegrations.syncError,
    syncRecordsDiscovered: shopifyIntegrations.syncRecordsDiscovered,
    syncRecordsAccepted: shopifyIntegrations.syncRecordsAccepted,
    syncRecordsDuplicates: shopifyIntegrations.syncRecordsDuplicates,
    syncRecordsRejected: shopifyIntegrations.syncRecordsRejected,
    // accessTokenEncrypted is intentionally excluded
  })
    .from(shopifyIntegrations)
    .where(eq(shopifyIntegrations.organizationId, session.organizationId))
    .limit(1)

  if (!integration) return NextResponse.json({ connected: false })

  const webhookHealthy = integration.status === 'ACTIVE' &&
    integration.syncError !== 'Webhook registration failed — live events not active'

  return NextResponse.json({
    connected: integration.status === 'ACTIVE',
    shopDomain: integration.shopDomain,
    status: integration.status,
    // webhookHealthy: false means Shopify connected but live event delivery is impaired
    webhookHealthy,
    webhookMessage: webhookHealthy ? null : 'Webhook setup requires attention. Use Sync now for manual updates.',
    installedAt: integration.installedAt,
    uninstalledAt: integration.uninstalledAt,
    lastWebhookAt: integration.lastWebhookAt,
    lastSyncAt: integration.lastSyncAt,
    syncStatus: integration.syncStatus,
    syncStartedAt: integration.syncStartedAt,
    syncCompletedAt: integration.syncCompletedAt,
    syncError: integration.syncError && integration.syncError !== 'Webhook registration failed — live events not active'
      ? 'Sync encountered errors — check sync status' : null,  // Sanitized — never expose raw errors
    syncCounts: {
      discovered: integration.syncRecordsDiscovered ?? 0,
      accepted: integration.syncRecordsAccepted ?? 0,
      duplicates: integration.syncRecordsDuplicates ?? 0,
      rejected: integration.syncRecordsRejected ?? 0,
    },
    // NEVER returned: accessToken, accessTokenEncrypted, client secret, encryption key
  })
}

export async function DELETE(_req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['OWNER', 'ADMIN'].includes(session.role)) return NextResponse.json({ error: 'Only OWNER or ADMIN can disconnect Shopify' }, { status: 403 })

  const db = getDb()
  const [integration] = await db.select({ id: shopifyIntegrations.id })
    .from(shopifyIntegrations)
    .where(and(eq(shopifyIntegrations.organizationId, session.organizationId), eq(shopifyIntegrations.status, 'ACTIVE')))
    .limit(1)

  if (!integration) return NextResponse.json({ error: 'No active Shopify integration found' }, { status: 404 })

  // Disconnect: set status DISCONNECTED, clear encrypted token, preserve history
  await db.update(shopifyIntegrations).set({
    status: 'DISCONNECTED',
    accessTokenEncrypted: '[revoked]',  // Cannot be decrypted — effectively deleted
    uninstalledAt: new Date(),
    syncStatus: 'IDLE',
    syncCursor: null,
    updatedAt: new Date(),
  }).where(eq(shopifyIntegrations.id, integration.id))

  // Historical transactions/incidents are preserved (no delete)
  console.info(`[shopify] Disconnected by ${session.role} (org: ${session.organizationId})`)

  return NextResponse.json({ disconnected: true })
}
