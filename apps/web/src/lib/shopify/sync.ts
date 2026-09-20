/**
 * Shopify historical order sync.
 *
 * Fetches orders in paginated batches using GraphQL cursor pagination.
 * Resumable: persists cursor after each batch so failure doesn't restart from zero.
 * Feeds existing analysis pipeline — no separate Shopify fraud engine.
 *
 * Default sync period: last 90 days (configurable per integration).
 * Batch size: 50 orders per GraphQL request.
 */
import { getDb } from '@/lib/db'
import { shopifyIntegrations, transactions, stores } from '@shopguard/database'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { decryptToken } from './token-encryption'
import { shopifyGraphQL, ShopifyThrottleError } from './client'
import { normalizeShopifyOrder, normalizeShopifyRefund, type ShopifyOrder } from './adapter'
import { enqueueAnalysis, getRedis, QUEUE_NAMES, runJobInline } from '@/lib/queue/index'
import type { NormalizedTransaction } from '@/lib/pos/adapter'

const BATCH_SIZE = 50
const DEFAULT_SYNC_DAYS = 90

interface SyncResult {
  discovered: number
  accepted: number
  duplicates: number
  rejected: number
  cursor: string | null
  complete: boolean
  error?: string
}

/** Run one batch of historical sync. Call repeatedly until complete=true. */
export async function runShopifySyncBatch(integrationId: string): Promise<SyncResult> {
  const db = getDb()
  const [integration] = await db
    .select()
    .from(shopifyIntegrations)
    .where(and(eq(shopifyIntegrations.id, integrationId), eq(shopifyIntegrations.status, 'ACTIVE')))
    .limit(1)

  if (!integration) return { discovered: 0, accepted: 0, duplicates: 0, rejected: 0, cursor: null, complete: true, error: 'Integration not found or inactive' }

  let accessToken: string
  try {
    accessToken = decryptToken(integration.accessTokenEncrypted)
  } catch {
    return { discovered: 0, accepted: 0, duplicates: 0, rejected: 0, cursor: null, complete: true, error: 'Failed to decrypt access token' }
  }

  // Date range: from (now - 90 days) or from cursor
  const sinceDate = new Date(Date.now() - DEFAULT_SYNC_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const cursor = integration.syncCursor

  // Transition from QUEUED → RUNNING (also handles IDLE → RUNNING from manual trigger)
  await db.update(shopifyIntegrations)
    .set({
      syncStatus: 'RUNNING',
      // Only set syncStartedAt on first batch (no cursor = fresh start)
      syncStartedAt: cursor ? undefined : new Date(),
      // Reset counts on fresh start
      syncRecordsDiscovered: cursor ? undefined : 0,
      syncRecordsAccepted: cursor ? undefined : 0,
      syncRecordsDuplicates: cursor ? undefined : 0,
      syncRecordsRejected: cursor ? undefined : 0,
      updatedAt: new Date(),
    })
    .where(eq(shopifyIntegrations.id, integrationId))

  try {
    // GraphQL orders query with cursor pagination
    // Throttle retry: up to 3 attempts with exponential backoff
    let data!: {
      orders: {
        edges: Array<{ node: ShopifyOrder; cursor: string }>
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    }
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        data = await shopifyGraphQL<typeof data>(integration.shopDomain, accessToken, `
      query FetchOrders($first: Int!, $after: String, $query: String) {
        orders(first: $first, after: $after, query: $query, sortKey: PROCESSED_AT) {
          edges {
            cursor
            node {
              id name createdAt processedAt currencyCode
              financialStatus cancelledAt cancelReason
              currentTotalPriceSet { shopMoney { amount currencyCode } }
              currentSubtotalPriceSet { shopMoney { amount currencyCode } }
              totalDiscountsSet { shopMoney { amount currencyCode } }
              totalTaxSet { shopMoney { amount currencyCode } }
              currentTotalRefundsSet { shopMoney { amount currencyCode } }
              lineItems(first: 10) { edges { node { quantity } } }
              transactions(first: 5) { edges { node { id kind gateway status amountSet { shopMoney { amount currencyCode } } processedAt } } }
              refunds {
                id createdAt
                refundLineItems { quantity }
                transactions(first: 5) { edges { node { id kind gateway status amountSet { shopMoney { amount currencyCode } } processedAt } } }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, {
          first: BATCH_SIZE,
          after: cursor ?? null,
          // sinceDate is dynamic UTC timestamp computed above — not hardcoded
          query: `processed_at:>=${sinceDate.slice(0, 10)}`,
        })
        break  // Success — exit retry loop
      } catch (err: unknown) {
        if (err instanceof ShopifyThrottleError && attempt < 3) {  // eslint-disable-line @typescript-eslint/no-unsafe-member-access
          const delay = Math.min(err.retryAfterMs, 5000)  // Cap at 5s
          console.warn(`[shopify/sync] Throttled by Shopify, retrying in ${delay}ms (attempt ${attempt + 1}/3)`)
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        throw err  // Non-throttle error or max retries exceeded
      }
    }

    const edges = data.orders.edges
    const pageInfo = data.orders.pageInfo

    // Get or use existing store for this org
    const [store] = await db.select({ id: stores.id })
      .from(stores).where(eq(stores.organizationId, integration.organizationId)).limit(1)
    const storeId = integration.storeId ?? store?.id

    if (!storeId) {
      return { discovered: 0, accepted: 0, duplicates: 0, rejected: 0, cursor: null, complete: true, error: 'No store configured for this organization' }
    }

    let discovered = 0, accepted = 0, duplicates = 0, rejected = 0
    const acceptedTxIds: string[] = []

    for (const { node: order } of edges) {
      discovered++
      const normalized = normalizeShopifyOrder(order)
      if (!normalized) { rejected++; continue }

      const result = await persistNormalizedTx(normalized, integration.organizationId, storeId, 'SHOPIFY')
      if (result === 'accepted') { accepted++; acceptedTxIds.push(normalized.externalId) }
      else if (result === 'duplicate') duplicates++
      else rejected++

      // Also persist refunds separately
      for (const refund of order.refunds ?? []) {
        discovered++
        const normalizedRefund = normalizeShopifyRefund(refund, order.currencyCode)
        if (!normalizedRefund) { rejected++; continue }
        const rr = await persistNormalizedTx(normalizedRefund, integration.organizationId, storeId, 'SHOPIFY')
        if (rr === 'accepted') accepted++
        else if (rr === 'duplicate') duplicates++
        else rejected++
      }
    }

    const newCursor = pageInfo.hasNextPage ? pageInfo.endCursor : null
    const complete = !pageInfo.hasNextPage

    // Persist cursor and counts
    await db.update(shopifyIntegrations).set({
      syncCursor: newCursor,
      syncStatus: complete ? 'COMPLETED' : 'RUNNING',
      syncCompletedAt: complete ? new Date() : undefined,
      syncRecordsDiscovered: (integration.syncRecordsDiscovered ?? 0) + discovered,
      syncRecordsAccepted: (integration.syncRecordsAccepted ?? 0) + accepted,
      syncRecordsDuplicates: (integration.syncRecordsDuplicates ?? 0) + duplicates,
      syncRecordsRejected: (integration.syncRecordsRejected ?? 0) + rejected,
      lastSyncAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(shopifyIntegrations.id, integrationId))

    // Queue analysis for accepted transactions
    if (acceptedTxIds.length > 0) {
      const redis = getRedis()
      const analysisKey = `shopify:sync:${integrationId}:${nanoid()}`
      // Get actual transaction IDs for analysis
      const txRows = await db.select({ id: transactions.id })
        .from(transactions)
        .where(and(
          eq(transactions.organizationId, integration.organizationId),
          eq(transactions.source, 'shopify')
        ))
        .limit(acceptedTxIds.length)
      const txIds = txRows.map(r => r.id)
      if (txIds.length > 0) {
        if (redis) {
          await enqueueAnalysis({ organizationId: integration.organizationId, transactionIds: txIds, idempotencyKey: analysisKey }).catch(() => {})
        } else {
          Promise.resolve().then(() =>
            runJobInline(QUEUE_NAMES.ANALYSIS, { organizationId: integration.organizationId, transactionIds: txIds, idempotencyKey: analysisKey })
          ).catch(() => {})
        }
      }
    }

    return { discovered, accepted, duplicates, rejected, cursor: newCursor, complete }
  } catch (err) {
    const errorMsg = String(err).slice(0, 500)
    await db.update(shopifyIntegrations).set({
      syncStatus: 'FAILED',
      syncError: errorMsg,
      updatedAt: new Date(),
    }).where(eq(shopifyIntegrations.id, integrationId))
    return { discovered: 0, accepted: 0, duplicates: 0, rejected: 0, cursor: null, complete: true, error: errorMsg }
  }
}

type PersistResult = 'accepted' | 'duplicate' | 'rejected'

async function persistNormalizedTx(
  tx: NormalizedTransaction,
  organizationId: string,
  storeId: string,
  source: string
): Promise<PersistResult> {
  const db = getDb()
  try {
    const txId = nanoid()
    await db.insert(transactions).values({
      id: txId,
      organizationId,
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
      notes: tx.notes ?? null,
      metadata: tx.metadata ?? null,
      source: 'shopify',
      dataSource: 'SHOPIFY',
      isDemo: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    return 'accepted'
  } catch (err) {
    const msg = String(err)
    if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('23505')) return 'duplicate'
    console.error('[shopify/sync] persist error:', msg.slice(0, 100))
    return 'rejected'
  }
}

