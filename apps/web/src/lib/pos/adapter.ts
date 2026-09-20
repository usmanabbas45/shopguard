/**
 * ShopGuard POS Adapter Interface
 *
 * Defines the contract that any POS integration must implement.
 * Current implementations: CSVAdapter (V1)
 * Future: ShopifyAdapter, SquareAdapter, LightspeedAdapter, etc.
 *
 * The risk engine consumes the normalized Transaction model
 * regardless of source — this adapter pattern ensures that.
 */

import type { Transaction } from '@shopguard/types'

// ==================== NORMALIZED MODELS ====================

export interface NormalizedEmployee {
  externalId: string
  name: string
  role?: string
  email?: string
  phone?: string
}

export interface NormalizedStore {
  externalId: string
  name: string
  code?: string
  address?: string
  timezone?: string
}

export interface NormalizedRegister {
  externalId: string
  storeExternalId: string
  name: string
  code?: string
}

export interface NormalizedCashEvent {
  externalId: string
  registerId: string
  employeeId?: string
  type: 'open' | 'close' | 'count' | 'adjustment'
  amount: number
  timestamp: Date
  notes?: string
}

export interface NormalizedTransaction {
  externalId: string
  storeExternalId?: string
  registerExternalId?: string
  employeeExternalId?: string
  timestamp: Date
  currency: string
  grossAmount: number
  discountAmount: number
  refundAmount: number
  netAmount: number
  paymentMethod: string
  isVoid: boolean
  isRefund: boolean
  isNoSale: boolean
  hasPriceOverride: boolean
  discountPercent?: number
  itemCount?: number
  durationSeconds?: number
  notes?: string
  metadata?: Record<string, unknown>
}

// ==================== ADAPTER INTERFACE ====================

export interface POSAdapterConfig {
  organizationId: string
  credentials?: Record<string, string>
  storeIds?: string[]
  timezone?: string
}

export interface WebhookEvent {
  provider: string
  eventType: string
  rawPayload: unknown
  receivedAt: Date
  idempotencyKey: string
}

export abstract class POSAdapter {
  abstract readonly name: string
  abstract readonly version: string

  constructor(protected config: POSAdapterConfig) {}

  /** Verify the adapter can connect to the POS */
  abstract connect(): Promise<{ success: boolean; error?: string }>

  /** Fetch transactions for a date range */
  abstract fetchTransactions(since: Date, until?: Date): Promise<NormalizedTransaction[]>

  /** Fetch employees */
  abstract fetchEmployees(): Promise<NormalizedEmployee[]>

  /** Fetch stores */
  abstract fetchStores(): Promise<NormalizedStore[]>

  /** Fetch registers */
  abstract fetchRegisters(): Promise<NormalizedRegister[]>

  /** Fetch cash events */
  abstract fetchCashEvents(since: Date, until?: Date): Promise<NormalizedCashEvent[]>

  /** Parse a webhook payload from this POS provider */
  abstract parseWebhook(event: WebhookEvent): Promise<NormalizedTransaction[] | null>

  /** Verify webhook signature */
  abstract verifyWebhookSignature(payload: string, signature: string): boolean
}

// ==================== CSV ADAPTER ====================

/**
 * CSVAdapter - V1 implementation.
 * Reads pre-imported CSV data from the database (already normalized).
 * The "connection" is always successful since data comes from our DB.
 */
export class CSVAdapter extends POSAdapter {
  readonly name = 'csv'
  readonly version = '1.0.0'

  async connect(): Promise<{ success: boolean; error?: string }> {
    return { success: true }
  }

  async fetchTransactions(since: Date, until?: Date): Promise<NormalizedTransaction[]> {
    // CSV data is already in the DB. This adapter delegates to the DB.
    // Used for completeness of the interface.
    return []
  }

  async fetchEmployees(): Promise<NormalizedEmployee[]> {
    return []
  }

  async fetchStores(): Promise<NormalizedStore[]> {
    return []
  }

  async fetchRegisters(): Promise<NormalizedRegister[]> {
    return []
  }

  async fetchCashEvents(): Promise<NormalizedCashEvent[]> {
    return []
  }

  async parseWebhook(): Promise<null> {
    // CSV adapter doesn't support webhooks
    return null
  }

  verifyWebhookSignature(): boolean {
    return false
  }
}

// ==================== WEBHOOK NORMALIZER ====================

/**
 * Normalizes a raw webhook event to a NormalizedTransaction.
 * Each POS provider has different payload formats.
 */
export async function normalizeWebhookEvent(
  provider: string,
  event: WebhookEvent,
  config: POSAdapterConfig
): Promise<NormalizedTransaction[] | null> {
  let adapter: POSAdapter

  switch (provider.toLowerCase()) {
    case 'csv':
      adapter = new CSVAdapter(config)
      break
    // Shopify uses its own dedicated webhook endpoint (/api/integrations/shopify/webhook)
    // with HMAC verification, not the generic adapter pattern.
    // case 'shopify': handled by /api/integrations/shopify/webhook
    // Square, Lightspeed, Toast, Clover: not yet implemented
    default:
      console.warn(`[webhook] Unknown POS provider: ${provider}`)
      return null
  }

  return adapter.parseWebhook(event)
}
