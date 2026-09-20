import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'
import { getDb } from '@/lib/db'
import { users, memberships, organizations, orgSettings, subscriptions, sessions } from '@shopguard/database'
import { eq } from 'drizzle-orm'
import { cookies } from 'next/headers'

const signupSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  orgName: z.string().min(2).max(200),
  businessType: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = signupSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
    }
    const { name, email, password, orgName, businessType } = parsed.data

    const db = getDb()

    // Check existing user
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const userId = nanoid()
    const orgId = nanoid()
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + nanoid(6)

    // Create user
    await db.insert(users).values({
      id: userId,
      email,
      passwordHash,
      name,
      emailVerified: false,
      isActive: true,
    })

    // Create organization
    await db.insert(organizations).values({
      id: orgId,
      name: orgName,
      slug,
      timezone: 'UTC',   // Organizations set their own timezone in Settings
      currency: 'USD',   // Organizations set their own currency in Settings
      locale: 'en',
      businessType: businessType || null,
      isDemo: false,
      isActive: true,
    })

    // Create org settings
    await db.insert(orgSettings).values({
      id: nanoid(),
      organizationId: orgId,
    })

    // Create subscription (trial)
    const trialEnd = new Date()
    trialEnd.setDate(trialEnd.getDate() + 14)
    await db.insert(subscriptions).values({
      id: nanoid(),
      organizationId: orgId,
      plan: 'TRIAL',
      status: 'TRIALING',
      trialEndsAt: trialEnd,
    })

    // Create membership
    await db.insert(memberships).values({
      id: nanoid(),
      organizationId: orgId,
      userId,
      role: 'OWNER',
      isActive: true,
    })

    // Create session
    const token = nanoid(48)
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    await db.insert(sessions).values({
      id: nanoid(),
      userId,
      token,
      expiresAt,
    })

    const cookieStore = await cookies()
    cookieStore.set('sg_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: expiresAt,
      path: '/',
    })

    return NextResponse.json({ success: true, userId, organizationId: orgId, redirectTo: '/onboarding' })
  } catch (err) {
    console.error('[signup]', err)
    const isDbError = err instanceof Error && (
      err.message.includes('connect ECONNREFUSED') ||
      err.message.includes('getaddrinfo') ||
      err.message.includes('ENOTFOUND') ||
      err.message.includes('FATAL')
    )
    return NextResponse.json(
      { error: isDbError
          ? 'Service temporarily unavailable. Please try again shortly.'
          : 'Registration failed. Please try again.' },
      { status: isDbError ? 503 : 500 }
    )
  }
}
