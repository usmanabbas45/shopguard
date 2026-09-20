/**
 * Vercel Cron Job — Process periodic tasks
 *
 * On Vercel serverless, BullMQ workers cannot run persistently.
 * This endpoint handles periodic tasks like follow-ups and health checks.
 *
 * Schedule: every 5 minutes (configured in vercel.json)
 * Auth: CRON_SECRET header required
 */
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 55

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  // CRON_SECRET is always required — if not set, cron is blocked to prevent open access
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[cron] CRON_SECRET is not configured — rejecting request for safety')
    return NextResponse.json({ error: 'Cron not configured' }, { status: 503 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, unknown> = {}
  const start = Date.now()

  // Process follow-ups
  try {
    const { processFollowUps } = await import('@/lib/services/notification-engine')
    const sent = await processFollowUps()
    results.followups = { sent }
  } catch (e) {
    results.followups = { error: String(e).slice(0, 100) }
  }

  // Shopify sync: process one batch per queued integration
  // Integrations with syncStatus = 'QUEUED' are picked up here (durable signal from DB).
  // Each cron tick processes one batch per integration; cursor persists for next tick.
  // This is the Vercel-compatible consumer for Shopify sync jobs (no persistent worker needed).
  try {
    const { getDb } = await import('@/lib/db')
    const { shopifyIntegrations } = await import('@shopguard/database')
    const { eq, inArray } = await import('drizzle-orm')
    const db = getDb()
    // Find integrations that need syncing
    const pending = await db.select({ id: shopifyIntegrations.id, organizationId: shopifyIntegrations.organizationId })
      .from(shopifyIntegrations)
      .where(inArray(shopifyIntegrations.syncStatus, ['QUEUED', 'RUNNING']))
      .limit(5)  // Process at most 5 integrations per cron tick (55s budget)
    const syncResults: Array<{ integrationId: string; result: unknown }> = []
    for (const integration of pending) {
      try {
        const { runShopifySyncBatch } = await import('@/lib/shopify/sync')
        const result = await runShopifySyncBatch(integration.id)
        syncResults.push({ integrationId: integration.id, result })
      } catch (err) {
        syncResults.push({ integrationId: integration.id, result: { error: String(err).slice(0, 100) } })
      }
    }
    results.shopifySync = { processed: pending.length, results: syncResults }
  } catch (e) {
    results.shopifySync = { error: String(e).slice(0, 100) }
  }

  // Health check
  try {
    const { runHealthCheck } = await import('@/lib/services/health-check')
    await runHealthCheck()
    results.health = { ok: true }
  } catch (e) {
    results.health = { error: String(e).slice(0, 100) }
  }

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - start,
    timestamp: new Date().toISOString(),
    results,
  })
}

