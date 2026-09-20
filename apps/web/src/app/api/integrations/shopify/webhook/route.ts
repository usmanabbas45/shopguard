/**
 * POST /api/integrations/shopify/webhook
 *
 * Receives Shopify webhook events (orders/create, orders/updated, orders/cancelled,
 * refunds/create, app/uninstalled).
 *
 * SECURITY:
 * - Raw body read before JSON parsing
 * - HMAC-SHA256 verified with constant-time comparison (X-Shopify-Hmac-Sha256)
 * - Shop domain resolved from X-Shopify-Shop-Domain header (never from payload body)
 * - Idempotency via shopify_webhook_events UNIQUE(shop_domain, shopify_webhook_id)
 * - Duplicate delivery returns 200 (Shopify expects 2xx to stop retrying)
 * - Processing is fast (queued async) — webhook acknowledges within Shopify's 5s timeout
 */
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { shopifyIntegrations, shopifyWebhookEvents, transactions, stores } from '@shopguard/database'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { verifyWebhookHmac } from '@/lib/shopify/client'
import { decryptToken } from '@/lib/shopify/token-encryption'
import { normalizeShopifyWebhookOrder, normalizeShopifyWebhookRefund } from '@/lib/shopify/adapter'
import { enqueueAnalysis, getRedis, QUEUE_NAMES, runJobInline } from '@/lib/queue/index'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  // 1. Read raw body BEFORE any parsing (required for HMAC)
  const rawBody = await req.text()

  // 2. Verify HMAC signature
  const hmacHeader = req.headers.get('x-shopify-hmac-sha256') ?? ''
  if (!verifyWebhookHmac(rawBody, hmacHeader)) {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
  }

  // 3. Resolve identity from headers — never from payload body
  const shopDomain = req.headers.get('x-shopify-shop-domain') ?? ''
  const topic = req.headers.get('x-shopify-topic') ?? ''
  const webhookId = req.headers.get('x-shopify-webhook-id') ?? nanoid()

  if (!shopDomain) return NextResponse.json({ error: 'Missing shop domain header' }, { status: 400 })

  const db = getDb()

  // 4. Look up integration by shop domain
  const [integration] = await db.select({ id: shopifyIntegrations.id, organizationId: shopifyIntegrations.organizationId, storeId: shopifyIntegrations.storeId, status: shopifyIntegrations.status })
    .from(shopifyIntegrations).where(eq(shopifyIntegrations.shopDomain, shopDomain)).limit(1)

  // Handle app/uninstalled even if status is not ACTIVE
  if (!integration) return NextResponse.json({ received: true, message: 'Unknown shop' })

  // 5. Idempotency check
  try {
    await db.insert(shopifyWebhookEvents).values({ id: nanoid(), integrationId: integration.id, shopDomain, shopifyWebhookId: webhookId, topic, processedAt: new Date() })
  } catch (err) {
    const msg = String(err)
    if (msg.includes('unique') || msg.includes('23505')) {
      return NextResponse.json({ received: true, duplicate: true })  // Shopify retry — idempotent
    }
    // Other DB error — still return 200 to stop retries
    console.error('[shopify/webhook] Event storage failed:', msg.slice(0, 100))
    return NextResponse.json({ received: true, error: 'storage_failed' })
  }

  // 6. Handle app/uninstalled
  if (topic === 'app/uninstalled') {
    await db.update(shopifyIntegrations).set({ status: 'DISCONNECTED', uninstalledAt: new Date(), updatedAt: new Date() })
      .where(eq(shopifyIntegrations.id, integration.id))
    console.info(`[shopify/webhook] App uninstalled for shop: ${shopDomain}`)
    return NextResponse.json({ received: true })
  }

  // Skip processing for inactive integrations
  if (integration.status !== 'ACTIVE') return NextResponse.json({ received: true, message: 'Integration inactive' })

  // 7. Parse and normalize payload (async — acknowledge quickly)
  let payload: Record<string, unknown>
  try { payload = JSON.parse(rawBody) } catch { return NextResponse.json({ received: true, error: 'Invalid JSON' }) }

  // 8. Get store for this integration
  const [store] = await db.select({ id: stores.id }).from(stores).where(eq(stores.organizationId, integration.organizationId)).limit(1)
  const storeId = integration.storeId ?? store?.id
  if (!storeId) return NextResponse.json({ received: true, error: 'No store configured' })

  // 9. Normalize based on topic
  let normalizedTxns: import('@/lib/pos/adapter').NormalizedTransaction[] = []
  if (topic === 'orders/create' || topic === 'orders/updated' || topic === 'orders/cancelled') {
    normalizedTxns = normalizeShopifyWebhookOrder(payload)
  } else if (topic === 'refunds/create') {
    normalizedTxns = normalizeShopifyWebhookRefund(payload)
  }

  // 10. Persist and queue analysis
  // For orders/updated: use upsert — update status/amounts if record exists, insert if new.
  // For refunds (new unique externalId): always insert.
  // For orders/create and orders/cancelled: insert (unique constraint prevents duplicates).
  const acceptedTxIds: string[] = []
  const isUpdate = topic === 'orders/updated'

  for (const tx of normalizedTxns) {
    try {
      if (isUpdate) {
        // Try to update existing record first (idempotent status/amount update)
        const updated = await db.update(transactions)
          .set({
            transactionStatus: tx.isVoid ? 'VOIDED' : tx.isRefund ? 'REFUNDED' : 'COMPLETED',
            isVoid: tx.isVoid,
            isRefund: tx.isRefund,
            refundAmount: tx.refundAmount.toFixed(2),
            netAmount: tx.netAmount.toFixed(2),
            updatedAt: new Date(),
          })
          .where(and(
            eq(transactions.organizationId, integration.organizationId),
            eq(transactions.externalTransactionId, tx.externalId),
          ))
        // If no row was updated, this is a new sub-transaction — insert it
        // (Drizzle update returns affected rows via count check not available directly,
        //  so we fall through to insert with conflict-ignore for new records)
      }

      // Always attempt insert for new transactions (refunds from update, etc.)
      const txId = nanoid()
      await db.insert(transactions).values({
        id: txId,
        organizationId: integration.organizationId,
        storeId,
        registerId: null,
        employeeId: null,
        externalTransactionId: tx.externalId,
        timestamp: tx.timestamp,
        currency: tx.currency,
        grossAmount: tx.grossAmount.toFixed(2),
        discountAmount: tx.discountAmount.toFixed(2),
        refundAmount: tx.refundAmount.toFixed(2),
        netAmount: tx.netAmount.toFixed(2),
        paymentMethod: tx.paymentMethod,
        paymentProvider: 'shopify',
        transactionStatus: tx.isVoid ? 'VOIDED' : tx.isRefund ? 'REFUNDED' : 'COMPLETED',
        isVoid: tx.isVoid,
        isRefund: tx.isRefund,
        isNoSale: false,
        hasPriceOverride: false,
        discountPercent: tx.discountPercent?.toFixed(2) ?? null,
        itemCount: tx.itemCount ?? null,
        metadata: tx.metadata ?? null,
        source: 'shopify',
        dataSource: 'SHOPIFY',
        isDemo: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      acceptedTxIds.push(txId)
    } catch (err) {
      const msg = String(err)
      if (msg.includes('unique') || msg.includes('23505')) {
        // Existing order record — already updated above (for orders/updated)
        // or genuine duplicate for create/cancelled — safe to ignore
      } else {
        console.error('[shopify/webhook] persist error:', msg.slice(0, 100))
      }
    }
  }

  // Update lastWebhookAt
  await db.update(shopifyIntegrations).set({ lastWebhookAt: new Date(), updatedAt: new Date() })
    .where(eq(shopifyIntegrations.id, integration.id))

  // Queue analysis (fire-and-forget)
  if (acceptedTxIds.length > 0) {
    const redis = getRedis()
    const jobKey = `shopify:webhook:${webhookId}`
    if (redis) {
      await enqueueAnalysis({ organizationId: integration.organizationId, transactionIds: acceptedTxIds, idempotencyKey: jobKey }).catch(() => {})
    } else {
      Promise.resolve().then(() => runJobInline(QUEUE_NAMES.ANALYSIS, { organizationId: integration.organizationId, transactionIds: acceptedTxIds, idempotencyKey: jobKey })).catch(() => {})
    }
  }

  return NextResponse.json({ received: true, processed: acceptedTxIds.length })
}
