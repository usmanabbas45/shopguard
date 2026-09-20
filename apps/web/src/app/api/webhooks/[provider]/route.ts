/**
 * POST /api/webhooks/[provider]
 *
 * Real-time transaction events from POS webhooks.
 * Authentication: Bearer sg_live_<key> (org API key)
 * Idempotency: externalTransactionId per org
 *
 * Provider adapters (interface only — implementations added when credentials available):
 *   generic  — raw ShopGuard JSON format (use this for custom integrations)
 *   Future: shopify, square, lightspeed, toast, clover
 */
import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { getDb } from '@/lib/db'
import { organizations, transactions, stores, employees, registers } from '@shopguard/database'
import { eq } from 'drizzle-orm'
import { validateApiKey } from '@/lib/ingestion/api-keys'
import { checkRateLimit } from '@/lib/ingestion/rate-limit'
import { enqueueAnalysis, getRedis, QUEUE_NAMES, runJobInline } from '@/lib/queue/index'
import { normalizePaymentMethod } from '@/lib/payment-methods'
import type { WebhookEvent } from '@/lib/pos/adapter'

export const runtime = 'nodejs'

// Supported provider adapters
const SUPPORTED_PROVIDERS = ['generic'] as const
type SupportedProvider = typeof SUPPORTED_PROVIDERS[number]

// Coming soon — interface only
const PLANNED_PROVIDERS = ['shopify', 'square', 'lightspeed', 'toast', 'clover']

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider } = await params

    // Reject unimplemented providers clearly
    if (PLANNED_PROVIDERS.includes(provider)) {
      return NextResponse.json({
        error: `${provider} integration is not yet implemented.`,
        message: `Use the generic provider or /api/ingest/transactions with your ${provider} data.`,
        documentation: 'https://shopguard-web.vercel.app/docs/api',
      }, { status: 501 })
    }

    if (!SUPPORTED_PROVIDERS.includes(provider as SupportedProvider)) {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 })
    }

    // Authentication
    const authHeader = req.headers.get('authorization') ?? ''
    const rawKey = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!rawKey) {
      return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 })
    }

    const keyRecord = await validateApiKey(rawKey)
    if (!keyRecord) {
      return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 })
    }

    const { organizationId, keyId } = keyRecord

    // Rate limit
    const rateCheck = await checkRateLimit(keyId)
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }

    // Check org is not demo
    const db = getDb()
    const [org] = await db
      .select({ isDemo: organizations.isDemo, isActive: organizations.isActive })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1)

    if (!org || !org.isActive || org.isDemo) {
      return NextResponse.json({ error: 'Organization inactive or demo' }, { status: 403 })
    }

    // Parse
    let rawPayload: unknown
    try { rawPayload = await req.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const idempotencyKey = req.headers.get('x-idempotency-key') ?? nanoid()
    const event: WebhookEvent = {
      provider,
      eventType: req.headers.get('x-event-type') ?? 'transaction',
      rawPayload,
      receivedAt: new Date(),
      idempotencyKey,
    }

    const { normalizeWebhookEvent } = await import('@/lib/pos/adapter')
    const normalizedTxns = await normalizeWebhookEvent(provider, event, { organizationId })

    if (!normalizedTxns || normalizedTxns.length === 0) {
      return NextResponse.json({ received: true, processed: 0 })
    }

    // Resolve store
    const [store] = await db
      .select({ id: stores.id })
      .from(stores)
      .where(eq(stores.organizationId, organizationId))
      .limit(1)

    if (!store) {
      return NextResponse.json({ error: 'No stores configured for this organization' }, { status: 422 })
    }

    const txIds: string[] = []
    const duplicates: string[] = []

    for (const ntx of normalizedTxns) {
      try {
        const txId = nanoid()
        await db.insert(transactions).values({
          id: txId,
          organizationId,
          storeId: store.id,
          externalTransactionId: ntx.externalId,
          timestamp: ntx.timestamp,
          currency: ntx.currency,
          grossAmount: ntx.grossAmount.toFixed(2),
          discountAmount: ntx.discountAmount.toFixed(2),
          refundAmount: ntx.refundAmount.toFixed(2),
          netAmount: ntx.netAmount.toFixed(2),
          paymentMethod: normalizePaymentMethod(ntx.paymentMethod),
          transactionStatus: ntx.isVoid ? 'VOIDED' : ntx.isRefund ? 'REFUNDED' : 'COMPLETED',
          isVoid: ntx.isVoid,
          isRefund: ntx.isRefund,
          isNoSale: ntx.isNoSale,
          hasPriceOverride: ntx.hasPriceOverride,
          discountPercent: ntx.discountPercent?.toFixed(2) ?? null,
          itemCount: ntx.itemCount ?? null,
          source: `webhook_${provider}`,
          dataSource: 'WEBHOOK',
          isDemo: false,
        }).onConflictDoNothing()
        txIds.push(txId)
      } catch (err) {
        const msg = String(err)
        if (msg.includes('unique') || msg.includes('23505')) duplicates.push(ntx.externalId)
      }
    }

    if (txIds.length > 0) {
      const redis = getRedis()
      if (redis) {
        await enqueueAnalysis({ organizationId, transactionIds: txIds, idempotencyKey: `webhook:${nanoid()}` }).catch(() => {})
      } else {
        Promise.resolve().then(() =>
          runJobInline(QUEUE_NAMES.ANALYSIS, { organizationId, transactionIds: txIds, idempotencyKey: `webhook:${nanoid()}` })
        ).catch(console.error)
      }
    }

    return NextResponse.json({ received: true, processed: txIds.length, duplicates: duplicates.length, idempotencyKey })
  } catch (err) {
    console.error('[webhook]', err)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
