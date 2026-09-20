/**
 * POST /api/billing/checkout
 * Creates a Lemon Squeezy checkout session.
 * Variant IDs come from env vars — never from client.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { organizations, users, memberships } from '@shopguard/database'
import { eq } from 'drizzle-orm'
import { getBillingProvider, getVariantId } from '@/lib/billing/provider'
import { z } from 'zod'

const CheckoutSchema = z.object({
  plan: z.enum(['STARTER', 'GROWTH', 'ENTERPRISE']),
  cycle: z.enum(['monthly', 'yearly']),
})

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'OWNER') return NextResponse.json({ error: 'Only the owner can manage billing' }, { status: 403 })
  if (session.isDemo) return NextResponse.json({ error: 'Not available for demo organizations' }, { status: 400 })

  const provider = getBillingProvider()
  if (!provider) return NextResponse.json({ error: 'Billing not configured (LEMONSQUEEZY_API_KEY not set)' }, { status: 503 })

  const parsed = CheckoutSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 422 })
  const { plan, cycle } = parsed.data

  let variantId: string
  try { variantId = getVariantId(plan, cycle) }
  catch (err) { return NextResponse.json({ error: String(err) }, { status: 503 }) }

  const db = getDb()
  const [org] = await db.select().from(organizations).where(eq(organizations.id, session.organizationId)).limit(1)
  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

  const [ownerRow] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(eq(memberships.organizationId, session.organizationId))
    .limit(1)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://shopguard-web.vercel.app'

  const checkoutSession = await provider.createCheckoutSession({
    variantId,
    successUrl: `${appUrl}/dashboard?billing=success`,
    cancelUrl: `${appUrl}/settings?billing=canceled`,
    orgId: org.id,
    orgName: org.name,
    email: ownerRow?.email ?? session.email,
  })

  return NextResponse.json({ url: checkoutSession.url })
}

