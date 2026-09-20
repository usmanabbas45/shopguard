/**
 * ShopGuard Billing Provider Abstraction
 *
 * Provider: Lemon Squeezy (https://lemonsqueezy.com)
 * - Works globally including Pakistan
 * - Merchant of Record — they handle tax, VAT, compliance
 * - Payouts via Payoneer
 *
 * Required environment variables:
 *   LEMONSQUEEZY_API_KEY         — from LS Dashboard → Settings → API
 *   LEMONSQUEEZY_WEBHOOK_SECRET  — from LS Dashboard → Settings → Webhooks
 *   LEMONSQUEEZY_STORE_ID        — from LS Dashboard → Settings → General
 *   LEMONSQUEEZY_VARIANT_STARTER_MONTHLY  — variant ID from your product
 *   LEMONSQUEEZY_VARIANT_STARTER_YEARLY
 *   LEMONSQUEEZY_VARIANT_GROWTH_MONTHLY
 *   LEMONSQUEEZY_VARIANT_GROWTH_YEARLY
 *
 * DO NOT expose LEMONSQUEEZY_API_KEY to the browser.
 * DO NOT hardcode variant IDs — use env vars.
 *
 * RETAIL PAYMENTS (customer → retailer POS) are tracked in the transactions table.
 * SHOPGUARD SUBSCRIPTION BILLING is tracked in subscriptions + billing_events.
 * These are completely separate — never mix them.
 */

import axios from 'axios'
import crypto from 'crypto'

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface BillingCheckoutSession {
  id: string
  url: string
  expiresAt: Date
}

export interface BillingCustomer {
  providerCustomerId: string
  email: string
  name: string
}

export interface BillingSubscription {
  providerSubscriptionId: string
  providerCustomerId: string
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete'
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
  currency: string
}

export interface BillingWebhookEvent {
  id: string
  type: string
  livemode: boolean
  data: Record<string, unknown>
  timestamp: Date
}

export type BillingEventType =
  | 'checkout.completed'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'subscription.past_due'
  | 'invoice.paid'
  | 'invoice.payment_failed'

export interface BillingProvider {
  readonly name: string
  upsertCustomer(params: { email: string; name: string; orgId: string }): Promise<BillingCustomer>
  createCheckoutSession(params: {
    providerCustomerId?: string
    variantId: string
    successUrl: string
    cancelUrl: string
    orgId: string
    orgName: string
    email: string
  }): Promise<BillingCheckoutSession>
  getSubscription(providerSubscriptionId: string): Promise<BillingSubscription | null>
  cancelSubscription(providerSubscriptionId: string): Promise<void>
  verifyWebhook(rawBody: string | Buffer, signature: string): Promise<BillingWebhookEvent>
  mapEventType(providerEventType: string): BillingEventType | null
}

// ── Variant ID helper ─────────────────────────────────────────────────────────

/**
 * Get Lemon Squeezy Variant ID from env vars at call time.
 * Set these in Vercel after creating your products in LS Dashboard.
 */
export function getVariantId(plan: string, cycle: 'monthly' | 'yearly'): string {
  const envKey = `LEMONSQUEEZY_VARIANT_${plan.toUpperCase()}_${cycle.toUpperCase()}`
  const id = process.env[envKey]
  if (!id) {
    throw new Error(
      `Billing not configured: ${envKey} is not set. ` +
      `Create your product in Lemon Squeezy Dashboard and copy the Variant ID into this env var.`
    )
  }
  return id
}

// ── Lemon Squeezy implementation ──────────────────────────────────────────────

export class LemonSqueezybillingProvider implements BillingProvider {
  readonly name = 'lemonsqueezy'
  private readonly apiKey: string
  private readonly storeId: string
  private readonly client

  constructor() {
    const apiKey = process.env.LEMONSQUEEZY_API_KEY
    const storeId = process.env.LEMONSQUEEZY_STORE_ID
    if (!apiKey) throw new Error('LEMONSQUEEZY_API_KEY is not set')
    if (!storeId) throw new Error('LEMONSQUEEZY_STORE_ID is not set')
    this.apiKey = apiKey
    this.storeId = storeId
    this.client = axios.create({
      baseURL: 'https://api.lemonsqueezy.com/v1',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
    })
  }

  private get webhookSecret(): string {
    const s = process.env.LEMONSQUEEZY_WEBHOOK_SECRET
    if (!s) throw new Error('LEMONSQUEEZY_WEBHOOK_SECRET is not set')
    return s
  }

  async upsertCustomer(params: { email: string; name: string; orgId: string }): Promise<BillingCustomer> {
    // Lemon Squeezy doesn't have a separate customer API — customer is created
    // at checkout time. We return a placeholder that gets filled during checkout.
    return {
      providerCustomerId: `pending_${params.orgId}`,
      email: params.email,
      name: params.name,
    }
  }

  async createCheckoutSession(params: {
    providerCustomerId?: string
    variantId: string
    successUrl: string
    cancelUrl: string
    orgId: string
    orgName: string
    email: string
  }): Promise<BillingCheckoutSession> {
    const response = await this.client.post('/checkouts', {
      data: {
        type: 'checkouts',
        attributes: {
          checkout_options: {
            embed: false,
            media: false,
            logo: true,
          },
          checkout_data: {
            email: params.email,
            name: params.orgName,
            custom: {
              shopguard_org_id: params.orgId,
              shopguard_org_name: params.orgName,
            },
          },
          expires_at: null,
          redirect_url: params.successUrl,
        },
        relationships: {
          store: {
            data: { type: 'stores', id: this.storeId },
          },
          variant: {
            data: { type: 'variants', id: params.variantId },
          },
        },
      },
    })

    const checkout = response.data.data
    return {
      id: checkout.id,
      url: checkout.attributes.url,
      expiresAt: checkout.attributes.expires_at
        ? new Date(checkout.attributes.expires_at)
        : new Date(Date.now() + 24 * 60 * 60 * 1000),
    }
  }

  async getSubscription(providerSubscriptionId: string): Promise<BillingSubscription | null> {
    try {
      const response = await this.client.get(`/subscriptions/${providerSubscriptionId}`)
      const sub = response.data.data.attributes
      const statusMap: Record<string, BillingSubscription['status']> = {
        active: 'active',
        on_trial: 'trialing',
        past_due: 'past_due',
        paused: 'past_due',
        unpaid: 'unpaid',
        cancelled: 'canceled',
        expired: 'canceled',
      }
      return {
        providerSubscriptionId,
        providerCustomerId: String(response.data.data.relationships?.customer?.data?.id ?? ''),
        status: statusMap[sub.status] ?? 'active',
        currentPeriodStart: new Date(sub.renews_at ?? sub.created_at),
        currentPeriodEnd: new Date(sub.renews_at ?? sub.ends_at ?? sub.created_at),
        cancelAtPeriodEnd: sub.cancelled ?? false,
        currency: 'USD',
      }
    } catch {
      return null
    }
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    // DELETE cancels at period end in Lemon Squeezy
    await this.client.delete(`/subscriptions/${providerSubscriptionId}`)
  }

  async verifyWebhook(rawBody: string | Buffer, signature: string): Promise<BillingWebhookEvent> {
    // Lemon Squeezy signs with HMAC-SHA256
    const hmac = crypto.createHmac('sha256', this.webhookSecret)
    const digest = hmac.update(rawBody).digest('hex')

    if (digest !== signature) {
      throw new Error('Invalid webhook signature')
    }

    const payload = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8'))
    const meta = payload.meta ?? {}

    return {
      id: meta.event_name + '_' + (payload.data?.id ?? Date.now()),
      type: meta.event_name ?? 'unknown',
      livemode: !meta.test_mode,
      data: payload,
      timestamp: new Date(),
    }
  }

  mapEventType(providerEventType: string): BillingEventType | null {
    const map: Record<string, BillingEventType> = {
      'order_created':              'checkout.completed',
      'subscription_created':       'subscription.created',
      'subscription_updated':       'subscription.updated',
      'subscription_cancelled':     'subscription.canceled',
      'subscription_resumed':       'subscription.updated',
      'subscription_expired':       'subscription.canceled',
      'subscription_paused':        'subscription.past_due',
      'subscription_unpaused':      'subscription.updated',
      'subscription_payment_success': 'invoice.paid',
      'subscription_payment_failed':  'invoice.payment_failed',
      'subscription_payment_recovered': 'invoice.paid',
    }
    return map[providerEventType] ?? null
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function getBillingProvider(): BillingProvider | null {
  if (process.env.LEMONSQUEEZY_API_KEY) {
    try {
      return new LemonSqueezybillingProvider()
    } catch {
      return null
    }
  }
  return null
}

// ── Plan metadata ─────────────────────────────────────────────────────────────

export const SHOPGUARD_PLANS = {
  TRIAL: {
    id: 'TRIAL',
    name: 'Free Trial',
    limits: { stores: 1, transactionsPerMonth: 5_000, users: 3 },
    features: ['Dashboard', 'CSV import', 'Risk rules', 'Basic incidents'],
  },
  STARTER: {
    id: 'STARTER',
    name: 'Starter',
    limits: { stores: 3, transactionsPerMonth: 50_000, users: 5 },
    features: ['All Trial features', 'Reports', 'Email notifications', 'Employee analytics'],
  },
  GROWTH: {
    id: 'GROWTH',
    name: 'Growth',
    limits: { stores: 10, transactionsPerMonth: 500_000, users: 20 },
    features: ['All Starter features', 'ML analysis', 'Cash reconciliation', 'API access'],
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    limits: { stores: -1, transactionsPerMonth: -1, users: -1 },
    features: ['All Growth features', 'Unlimited everything', 'Custom integrations', 'SLA'],
  },
}

