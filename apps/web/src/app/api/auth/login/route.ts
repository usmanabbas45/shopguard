import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'
import { getDb } from '@/lib/db'
import { users, sessions, memberships, organizations } from '@shopguard/database'
import { eq, and } from 'drizzle-orm'
import { cookies } from 'next/headers'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 400 })
    }
    const { email, password } = parsed.data

    const db = getDb()

    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash, isActive: users.isActive })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)

    if (!user || !user.isActive) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // Get membership
    const [membership] = await db
      .select({ organizationId: memberships.organizationId, role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, user.id), eq(memberships.isActive, true)))
      .limit(1)

    if (!membership) {
      return NextResponse.json({ error: 'No organization found for this account' }, { status: 403 })
    }

    // Update last login
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id))

    // Create session
    const token = nanoid(48)
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await db.insert(sessions).values({
      id: nanoid(),
      userId: user.id,
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

    return NextResponse.json({ success: true })
  } catch (err) {
    // Structured error log — message only in production, no stack traces
    if (process.env.NODE_ENV === 'production') {
      const msg = err instanceof Error ? err.message.split('\n')[0] : String(err)
      console.error('[login] Error:', msg)
    } else {
      console.error('[login]', err)
    }
    // Detect DB connection errors — return 503 with neutral message (not 500)
    // Never expose internal error details to the client
    const isDbError = err instanceof Error && (
      err.message.includes('connect ECONNREFUSED') ||
      err.message.includes('getaddrinfo') ||
      err.message.includes('Connection refused') ||
      err.message.includes('ENOTFOUND') ||
      err.message.includes('password authentication') ||
      err.message.includes('FATAL')
    )
    if (isDbError) {
      return NextResponse.json(
        { error: 'Service temporarily unavailable. Please try again shortly.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }
}
