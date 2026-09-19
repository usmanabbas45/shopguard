import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { getDb } from '@/lib/db'
import { organizations, transactions, stores } from '@shopguard/database'
import { eq } from 'drizzle-orm'
import { enqueueAnalysis, getRedis, QUEUE_NAMES, runJobInline } from '@/lib/queue/index'
import type { WebhookEvent } from '@/lib/pos/adapter'

/**
 * POST /api/webhooks/[provider]
 *
 * Receives real-time transaction events from POS systems.
 * Currently supports: csv (for testing)
 * Future: shopify, square, lightspeed, toast, clover
 *
 * Authentication: Organization API key in Authorization header.
 * Idempotency: X-Idempotency-Key header or payload hash.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider } = await params

    // 1. Authenticate — require API key
    const authHeader = req.headers.get('Authorization')
    const apiKey = authHeader?.replace('Bearer ', '').trim()
    if (!apiKey) {
      return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 })
    }

    // Look up org by API key (stored in orgSettings or a dedicated table)
    // For V1: API key = organizationId (simplified, not production-ready)
    // Production: hash the API key and look up in an api_keys table
    const db = getDb()
    const [org] = await db
      .select({ id: organizations.id, isActive: organizations.isActive })
      .from(organizations)
      .where(eq(organizations.id, apiKey))
      .limit(1)

    if (!org || !org.isActive) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
    }

    // 2. Idempotency key
    const idempotencyKey = req.headers.get('X-Idempotency-Key') ?? nanoid()

    // 3. Parse payload
    let rawPayload: unknown
    try {
      rawPayload = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
    }

    const event: WebhookEvent = {
      provider,
      eventType: req.headers.get('X-Event-Type') ?? 'transaction',
      rawPayload,
      receivedAt: new Date(),
      idempotencyKey,
    }

    // 4. Normalize the webhook to transactions
    const { normalizeWebhookEvent } = await import('@/lib/pos/adapter')
    const normalizedTxns = await normalizeWebhookEvent(provider, event, { organizationId: org.id })

    if (!normalizedTxns || normalizedTxns.length === 0) {
      return NextResponse.json({ received: true, processed: 0, message: 'No transactions extracted' })
    }

    // 5. Persist transactions
    const txIds: string[] = []
    for (const ntx of normalizedTxns) {
      // Get or create store
      const [store] = await db
        .select({ id: stores.id })
        .from(stores)
        .where(eq(stores.organizationId, org.id))
        .limit(1)

      if (!store) continue

      const txId = nanoid()
      await db.insert(transactions).values({
        id: txId,
        organizationId: org.id,
        storeId: store.id,
        externalTransactionId: ntx.externalId,
        timestamp: ntx.timestamp,
        currency: ntx.currency,
        grossAmount: ntx.grossAmount.toFixed(2),
        discountAmount: ntx.discountAmount.toFixed(2),
        refundAmount: ntx.refundAmount.toFixed(2),
        netAmount: ntx.netAmount.toFixed(2),
        paymentMethod: ntx.paymentMethod,
        transactionStatus: ntx.isVoid ? 'VOIDED' : ntx.isRefund ? 'REFUNDED' : 'COMPLETED',
        isVoid: ntx.isVoid,
        isRefund: ntx.isRefund,
        isNoSale: ntx.isNoSale,
        hasPriceOverride: ntx.hasPriceOverride,
        discountPercent: ntx.discountPercent?.toFixed(2) ?? null,
        itemCount: ntx.itemCount ?? null,
        source: `webhook_${provider}`,
        isDemo: false,
      }).onConflictDoNothing()

      txIds.push(txId)
    }

    // 6. Queue analysis
    if (txIds.length > 0) {
      const analysisKey = `analysis:webhook:${idempotencyKey}`
      if (getRedis()) {
        await enqueueAnalysis({
          organizationId: org.id,
          transactionIds: txIds,
          idempotencyKey: analysisKey,
        })
      } else {
        // Run inline in dev
        Promise.resolve().then(() =>
          runJobInline(QUEUE_NAMES.ANALYSIS, {
            organizationId: org.id,
            transactionIds: txIds,
            idempotencyKey: analysisKey,
          })
        ).catch(console.error)
      }
    }

    return NextResponse.json({
      received: true,
      processed: txIds.length,
      queued: txIds.length > 0,
      idempotencyKey,
    })
  } catch (err) {
    console.error('[webhook]', err)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
