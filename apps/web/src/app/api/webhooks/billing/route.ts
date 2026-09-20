/**
 * POST /api/webhooks/billing
 *
 * Lemon Squeezy webhook handler.
 *
 * SECURITY:
 * 1. Raw body read before any parsing — required for HMAC signature.
 * 2. HMAC-SHA256 signature verified before any processing.
 * 3. Idempotency via billing_events UNIQUE(provider, provider_event_id).
 * 4. Org ID from webhook custom data (set at checkout) — never from client.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { subscriptions, billingEvents } from '@shopguard/database'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { getBillingProvider } from '@/lib/billing/provider'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const provider = getBillingProvider()
  if (!provider) {
    return NextResponse.json({ received: true, configured: false })
  }

  const rawBody = await req.text()

  // Lemon Squeezy sends signature in X-Signature header
  const signature = req.headers.get('x-signature') ?? ''
  if (!signature) {
    return NextResponse.json({ error: 'Missing x-signature header' }, { status: 400 })
  }

  let event
  try {
    event = await provider.verifyWebhook(rawBody, signature)
  } catch (err) {
    console.error('[billing/webhook] Signature failed:', String(err).slice(0, 100))
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
  }

  const shopguardEventType = provider.mapEventType(event.type)
  const db = getDb()

  // Idempotency check
  let billingEventId: string | null = null
  try {
    billingEventId = nanoid()
    await db.insert(billingEvents).values({
      id: billingEventId,
      organizationId: null,
      provider: provider.name,
      providerEventId: event.id,
      eventType: event.type,
      rawPayload: event.data,
    })
  } catch (err: unknown) {
    const msg = String(err)
    if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('23505')) {
      return NextResponse.json({ received: true, duplicate: true })
    }
    console.error('[billing/webhook] DB error:', msg.slice(0, 200))
    return NextResponse.json({ received: true, error: 'storage_failed' })
  }

  let orgId: string | null = null
  try {
    if (shopguardEventType === 'checkout.completed') {
      orgId = await handleOrderCreated(db, event.data)
    } else if (shopguardEventType === 'subscription.created' || shopguardEventType === 'subscription.updated') {
      orgId = await handleSubscriptionUpdated(db, event.data)
    } else if (shopguardEventType === 'subscription.canceled') {
      orgId = await handleSubscriptionCanceled(db, event.data)
    } else if (shopguardEventType === 'invoice.payment_failed') {
      orgId = await handlePaymentFailed(db, event.data)
    }
  } catch (err) {
    console.error(`[billing/webhook] Processing error for ${event.type}:`, String(err).slice(0, 200))
    return NextResponse.json({ received: true, processing_error: true })
  }

  if (orgId && billingEventId) {
    await db.update(billingEvents)
      .set({ organizationId: orgId })
      .where(eq(billingEvents.id, billingEventId))
      .catch(() => {})
  }

  return NextResponse.json({ received: true, eventType: shopguardEventType ?? event.type })
}

type Db = ReturnType<typeof getDb>

async function handleOrderCreated(db: Db, data: Record<string, unknown>): Promise<string | null> {
  // Lemon Squeezy puts custom data in meta.custom_data
  const meta = (data.meta ?? {}) as Record<string, unknown>
  const customData = (meta.custom_data ?? {}) as Record<string, string>
  const orgId = customData.shopguard_org_id
  if (!orgId) return null

  const orderData = (data.data ?? {}) as Record<string, unknown>
  const attrs = (orderData.attributes ?? {}) as Record<string, unknown>
  const firstOrderItem = ((attrs.first_order_item ?? {}) as Record<string, unknown>)
  const subscriptionId = String(firstOrderItem.subscription_id ?? '')

  if (subscriptionId && subscriptionId !== 'null') {
    await db.update(subscriptions)
      .set({ status: 'ACTIVE', providerSubscriptionId: subscriptionId, updatedAt: new Date() })
      .where(eq(subscriptions.organizationId, orgId))
  }
  return orgId
}

async function handleSubscriptionUpdated(db: Db, data: Record<string, unknown>): Promise<string | null> {
  const subData = (data.data ?? {}) as Record<string, unknown>
  const attrs = (subData.attributes ?? {}) as Record<string, unknown>
  const customData = (attrs.custom_data ?? {}) as Record<string, string>
  const orgId = customData.shopguard_org_id ?? null
  const subId = String(subData.id ?? '')

  const statusMap: Record<string, string> = {
    active: 'ACTIVE', on_trial: 'TRIALING', past_due: 'PAST_DUE',
    paused: 'PAST_DUE', unpaid: 'PAST_DUE', cancelled: 'CANCELLED', expired: 'EXPIRED',
  }
  const newStatus = statusMap[String(attrs.status ?? '')] ?? 'ACTIVE'

  await db.update(subscriptions)
    .set({ status: newStatus as 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED', updatedAt: new Date() })
    .where(eq(subscriptions.providerSubscriptionId, subId))

  return orgId
}

async function handleSubscriptionCanceled(db: Db, data: Record<string, unknown>): Promise<string | null> {
  const subData = (data.data ?? {}) as Record<string, unknown>
  const subId = String(subData.id ?? '')
  await db.update(subscriptions)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(eq(subscriptions.providerSubscriptionId, subId))
  const attrs = (subData.attributes ?? {}) as Record<string, unknown>
  const customData = (attrs.custom_data ?? {}) as Record<string, string>
  return customData.shopguard_org_id ?? null
}

async function handlePaymentFailed(db: Db, data: Record<string, unknown>): Promise<string | null> {
  const subData = (data.data ?? {}) as Record<string, unknown>
  const subId = String(subData.id ?? '')
  await db.update(subscriptions)
    .set({ status: 'PAST_DUE', updatedAt: new Date() })
    .where(eq(subscriptions.providerSubscriptionId, subId))
  return null
}

