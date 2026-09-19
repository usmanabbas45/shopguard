import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/db'
import { sessions } from '@shopguard/database'
import { eq } from 'drizzle-orm'

export async function POST() {
  const cookieStore = await cookies()
  const token = cookieStore.get('sg_session')?.value
  if (token) {
    try {
      await getDb().delete(sessions).where(eq(sessions.token, token))
    } catch {}
    cookieStore.delete('sg_session')
  }
  return NextResponse.json({ success: true })
}
