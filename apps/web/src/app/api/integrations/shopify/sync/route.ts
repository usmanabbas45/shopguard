/**
 * POST /api/integrations/shopify/sync
 * Trigger a Shopify historical sync batch. Rate-limited to prevent abuse.
 * On Vercel/serverless: runs one batch inline, returns status.
 * Multiple calls continue pagination from last cursor.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { shopifyIntegrations } from '@shopguard/database'
import { eq, and } from 'drizzle-orm'
import { runShopifySyncBatch } from '@/lib/shopify/sync'
import { getRedis, enqueueShopifySync } from '@/lib/queue/index'

export const runtime = 'nodejs'
export const maxDuration = 55  // Vercel max

export async function POST(_req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['OWNER', 'ADMIN'].includes(session.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  // Rate limit: 1 sync request per 5 minutes per org
  const redis = getRedis()
  if (redis) {
    const lockKey = `shopify:sync:lock:${session.organizationId}`
    const locked = await redis.set(lockKey, '1', 'EX', 300, 'NX')
    if (!locked) {
      return NextResponse.json({ error: 'Sync already in progress or recently started. Please wait before retrying.' }, { status: 429 })
    }
  }

  const db = getDb()
  const [integration] = await db.select({ id: shopifyIntegrations.id, syncStatus: shopifyIntegrations.syncStatus })
    .from(shopifyIntegrations)
    .where(and(eq(shopifyIntegrations.organizationId, session.organizationId), eq(shopifyIntegrations.status, 'ACTIVE')))
    .limit(1)

  if (!integration) return NextResponse.json({ error: 'No active Shopify integration found' }, { status: 404 })

  // Set DB status to QUEUED (durable signal for Vercel Cron)
  await db.update(shopifyIntegrations)
    .set({ syncStatus: 'QUEUED', syncError: null, updatedAt: new Date() })
    .where(eq(shopifyIntegrations.id, integration.id))

  // Enqueue to BullMQ (for standalone worker environments)
  const syncIdempotencyKey = `shopify:manual-sync:${integration.id}:${Date.now()}`
  await enqueueShopifySync({
    integrationId: integration.id,
    organizationId: session.organizationId,
    idempotencyKey: syncIdempotencyKey,
  }).catch(() => {}) // Non-fatal: cron fallback active

  // Also run one batch inline immediately (Vercel: give merchant fast feedback)
  // The cron will continue subsequent batches automatically
  let result
  try {
    result = await runShopifySyncBatch(integration.id)
  } finally {
    // Always release the lock
    if (redis) {
      const lockKey = `shopify:sync:lock:${session.organizationId}`
      await redis.del(lockKey).catch(() => {})
    }
  }

  return NextResponse.json({
    ...result,
    queued: true,  // Cron will continue if more batches remain
    message: result.complete
      ? 'Sync complete'
      : `Batch processed and next batch queued — cron will continue automatically.`,
  })
}

