import { cookies } from 'next/headers'
import { getDb } from './db'
import { eq } from 'drizzle-orm'
import { sessions, users, memberships, organizations } from '@shopguard/database'
import type { SessionUser } from '@shopguard/types'

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('sg_session')?.value
  if (!token) return null

  const db = getDb()
  const [session] = await db
    .select({
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.token, token))
    .limit(1)

  if (!session || session.expiresAt < new Date()) return null

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      isDemo: organizations.isDemo,
    })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!row) return null

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as SessionUser['role'],
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    organizationSlug: row.organizationSlug,
    isDemo: row.isDemo,
  }
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  return session
}

export function canAccess(userRole: SessionUser['role'], requiredRole: SessionUser['role']): boolean {
  const hierarchy: Record<string, number> = { OWNER: 5, ADMIN: 4, MANAGER: 3, INVESTIGATOR: 2, VIEWER: 1 }
  return (hierarchy[userRole] ?? 0) >= (hierarchy[requiredRole] ?? 0)
}
