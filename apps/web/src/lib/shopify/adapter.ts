/**
 * Shopify → ShopGuard transaction normalizer.
 *
 * Maps Shopify GraphQL order/refund data to ShopGuard's NormalizedTransaction.
 *
 * CRITICAL RULES:
 * - dataSource = 'SHOPIFY' always
 * - isDemo = false always (Shopify data is live data)
 * - Cash vs digital: uses existing normalizePaymentMethod() + isCashPayment()
 * - Shopify digital payments never affect cash drawer reconciliation
 * - No customer identity stored (customer GID not mapped to employee)
 * - Staff attribution only when Shopify provides attributedStaff/user field
 * - Unknown gateways normalize to 'OTHER' (no ingestion failure)
 * - externalTransactionId = shopify_order_{orderId} for orders, shopify_refund_{refundId} for refunds
 */

import { normalizePaymentMethod, isCashPayment } from '@/lib/payment-methods'
import { isSupportedCurrency } from '@/lib/money'
import type { NormalizedTransaction } from '@/lib/pos/adapter'

// ── Shopify GraphQL types (partial) ──────────────────────────────────────────

export interface ShopifyOrder {
  id: string                // GID: gid://shopify/Order/12345
  name: string              // Order number: #1001
  createdAt: string         // ISO 8601
  processedAt: string       // ISO 8601
  currencyCode: string      // ISO 4217
  currentTotalPriceSet: ShopifyMoneyBag
  currentSubtotalPriceSet: ShopifyMoneyBag
  totalDiscountsSet: ShopifyMoneyBag
  totalTaxSet: ShopifyMoneyBag
  currentTotalRefundsSet?: ShopifyMoneyBag
  financialStatus: string   // PAID | PENDING | REFUNDED | PARTIALLY_REFUNDED | VOIDED | AUTHORIZED
  cancelledAt: string | null
  cancelReason: string | null
  lineItems: { edges: Array<{ node: { quantity: number } }> }
  transactions: { edges: Array<{ node: ShopifyTransaction }> }
  refunds: Array<ShopifyRefund>
  locationId: string | null
}

export interface ShopifyTransaction {
  id: string
  kind: string              // SALE | REFUND | VOID | CAPTURE | AUTHORIZATION
  gateway: string           // shopify_payments, paypal, cash, etc.
  amountSet: ShopifyMoneyBag
  processedAt: string
  status: string            // SUCCESS | PENDING | FAILURE | ERROR
}

export interface ShopifyRefund {
  id: string
  createdAt: string
  refundLineItems: Array<{ quantity: number }>
  transactions: { edges: Array<{ node: ShopifyTransaction }> }
}

export interface ShopifyMoneyBag {
  shopMoney: { amount: string; currencyCode: string }
}

// ── Shopify payment gateway → canonical payment method ────────────────────────

const SHOPIFY_GATEWAY_MAP: Record<string, string> = {
  // Shopify's own gateways
  'shopify_payments':   'CARD',
  'shopify-coin':       'OTHER',
  'gift_card':          'OTHER',
  'cash':               'CASH',
  'manual':             'CASH',
  // Third-party
  'paypal':             'PAYPAL',
  'amazon_payments':    'ONLINE_CARD',
  'apple_pay':          'APPLE_PAY',
  'google_pay':         'GOOGLE_PAY',
  'afterpay':           'BNPL',
  'klarna':             'BNPL',
  'laybuy':             'BNPL',
  'affirm':             'BNPL',
  'stripe':             'CARD',
}

function normalizeGateway(gateway: string): string {
  if (!gateway) return 'UNKNOWN'
  const lower = gateway.toLowerCase().replace(/[-_\s]/g, '_')
  return SHOPIFY_GATEWAY_MAP[lower] ?? normalizePaymentMethod(gateway)
}

function parseAmount(moneyBag: ShopifyMoneyBag | null | undefined): number {
  if (!moneyBag) return 0
  return parseFloat(moneyBag.shopMoney.amount) || 0
}

function extractOrderId(gid: string): string {
  // gid://shopify/Order/12345 → 12345
  return gid.split('/').pop() ?? gid
}

function extractRefundId(gid: string): string {
  return gid.split('/').pop() ?? gid
}

/** Normalize a Shopify order into a ShopGuard NormalizedTransaction */
export function normalizeShopifyOrder(order: ShopifyOrder): NormalizedTransaction | null {
  // Skip cancelled orders with no payment (no useful fraud signal)
  if (order.cancelledAt && parseAmount(order.currentTotalPriceSet) === 0) return null

  const orderId = extractOrderId(order.id)
  const currency = order.currencyCode
  if (!isSupportedCurrency(currency)) return null

  const grossAmount = parseAmount(order.currentTotalPriceSet)
  const discountAmount = parseAmount(order.totalDiscountsSet)
  const refundAmount = parseAmount(order.currentTotalRefundsSet)
  const netAmount = grossAmount - refundAmount

  // Payment method: use first successful transaction gateway
  const txEdges = order.transactions?.edges ?? []
  const successfulTx = txEdges.find(e => e.node.status === 'SUCCESS' && e.node.kind === 'SALE')
    ?? txEdges[0]
  const gateway = successfulTx?.node.gateway ?? 'shopify_payments'
  const paymentMethod = normalizeGateway(gateway)

  const isVoid = order.financialStatus === 'VOIDED' || order.cancelReason === 'other'
  const isRefund = order.financialStatus === 'REFUNDED'
  const itemCount = order.lineItems.edges.reduce((sum, e) => sum + (e.node.quantity ?? 0), 0)

  const discountPercent = grossAmount > 0 ? (discountAmount / (grossAmount + discountAmount)) * 100 : 0

  return {
    externalId: `shopify_order_${orderId}`,
    timestamp: new Date(order.processedAt ?? order.createdAt),
    currency,
    grossAmount,
    discountAmount,
    refundAmount,
    netAmount,
    paymentMethod,
    isVoid,
    isRefund,
    isNoSale: false,
    hasPriceOverride: false,
    discountPercent: discountPercent > 0 ? discountPercent : undefined,
    itemCount,
    metadata: {
      shopifyOrderId: order.id,
      shopifyOrderName: order.name,
      financialStatus: order.financialStatus,
      gateway,
      cancelReason: order.cancelReason,
    },
  }
}

/** Normalize a Shopify refund into a NormalizedTransaction */
export function normalizeShopifyRefund(refund: ShopifyRefund, orderCurrency: string): NormalizedTransaction | null {
  const refundId = extractRefundId(refund.id)
  const txEdges = refund.transactions?.edges ?? []
  const refundTx = txEdges[0]?.node

  if (!refundTx) return null

  const amount = parseAmount(refundTx.amountSet)
  if (amount === 0) return null

  const gateway = refundTx.gateway ?? 'shopify_payments'
  const paymentMethod = normalizeGateway(gateway)
  const currency = refundTx.amountSet?.shopMoney?.currencyCode ?? orderCurrency

  return {
    externalId: `shopify_refund_${refundId}`,
    timestamp: new Date(refund.createdAt),
    currency,
    grossAmount: 0,
    discountAmount: 0,
    refundAmount: amount,
    netAmount: -amount,
    paymentMethod,
    isVoid: false,
    isRefund: true,
    isNoSale: false,
    hasPriceOverride: false,
    itemCount: refund.refundLineItems.reduce((s, i) => s + (i.quantity ?? 0), 0),
    metadata: {
      shopifyRefundId: refund.id,
      gateway,
    },
  }
}

/** Normalize a single Shopify webhook order payload */
export function normalizeShopifyWebhookOrder(payload: Record<string, unknown>): NormalizedTransaction[] {
  const results: NormalizedTransaction[] = []
  const currency = String(payload.currency ?? 'USD')

  // Map webhook order (REST format from Shopify webhooks)
  const orderId = String(payload.id ?? '')
  const orderName = String(payload.name ?? '')
  const grossAmount = parseFloat(String(payload.total_price ?? 0))
  const discountAmount = parseFloat(String(payload.total_discounts ?? 0))
  const taxAmount = parseFloat(String(payload.total_tax ?? 0))
  const netAmount = grossAmount
  const cancelledAt = payload.cancelled_at as string | null
  const financialStatus = String(payload.financial_status ?? '')
  const gateway = String((payload as Record<string, unknown>).gateway ?? 'shopify_payments')
  const paymentMethod = normalizeGateway(gateway)
  const isVoid = financialStatus === 'voided' || !!cancelledAt
  const isRefund = financialStatus === 'refunded'
  const lineItems = (payload.line_items as Array<{ quantity?: number }> | undefined) ?? []
  const itemCount = lineItems.reduce((s, i) => s + (i.quantity ?? 0), 0)
  const processedAt = String(payload.processed_at ?? payload.created_at ?? new Date().toISOString())

  if (!isSupportedCurrency(currency)) return results
  if (!orderId) return results

  results.push({
    externalId: `shopify_order_${orderId}`,
    timestamp: new Date(processedAt),
    currency,
    grossAmount,
    discountAmount,
    refundAmount: 0,
    netAmount,
    paymentMethod,
    isVoid,
    isRefund,
    isNoSale: false,
    hasPriceOverride: false,
    itemCount,
    metadata: {
      shopifyOrderId: `gid://shopify/Order/${orderId}`,
      shopifyOrderName: orderName,
      financialStatus,
      gateway,
    },
  })

  // Also normalize any embedded refunds
  const refunds = (payload.refunds as Array<Record<string, unknown>> | undefined) ?? []
  for (const refund of refunds) {
    const refundId = String(refund.id ?? '')
    if (!refundId) continue
    const refundTxs = (refund.transactions as Array<Record<string, unknown>> | undefined) ?? []
    const refundTx = refundTxs[0]
    if (!refundTx) continue
    const refundAmount = parseFloat(String(refundTx.amount ?? 0))
    if (refundAmount === 0) continue
    const refundGateway = String(refundTx.gateway ?? gateway)
    results.push({
      externalId: `shopify_refund_${refundId}`,
      timestamp: new Date(String(refund.created_at ?? processedAt)),
      currency,
      grossAmount: 0,
      discountAmount: 0,
      refundAmount,
      netAmount: -refundAmount,
      paymentMethod: normalizeGateway(refundGateway),
      isVoid: false,
      isRefund: true,
      isNoSale: false,
      hasPriceOverride: false,
      metadata: {
        shopifyRefundId: `gid://shopify/Refund/${refundId}`,
        shopifyOrderId: `gid://shopify/Order/${orderId}`,
        gateway: refundGateway,
      },
    })
  }

  return results
}

/** Normalize a Shopify refund webhook payload */
export function normalizeShopifyWebhookRefund(payload: Record<string, unknown>): NormalizedTransaction[] {
  const refundId = String(payload.id ?? '')
  if (!refundId) return []
  const txs = (payload.transactions as Array<Record<string, unknown>> | undefined) ?? []
  const refundTx = txs.find(t => String(t.kind ?? '') === 'refund') ?? txs[0]
  if (!refundTx) return []
  const amount = parseFloat(String(refundTx.amount ?? 0))
  if (amount === 0) return []
  const currency = String(refundTx.currency ?? payload.currency ?? 'USD')
  if (!isSupportedCurrency(currency)) return []
  const gateway = String(refundTx.gateway ?? 'shopify_payments')
  const orderId = String(payload.order_id ?? '')
  return [{
    externalId: `shopify_refund_${refundId}`,
    timestamp: new Date(String(payload.created_at ?? new Date().toISOString())),
    currency,
    grossAmount: 0,
    discountAmount: 0,
    refundAmount: amount,
    netAmount: -amount,
    paymentMethod: normalizeGateway(gateway),
    isVoid: false,
    isRefund: true,
    isNoSale: false,
    hasPriceOverride: false,
    metadata: {
      shopifyRefundId: `gid://shopify/Refund/${refundId}`,
      shopifyOrderId: orderId ? `gid://shopify/Order/${orderId}` : undefined,
      gateway,
    },
  }]
}

