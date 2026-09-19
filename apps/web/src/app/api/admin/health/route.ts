import { NextResponse } from 'next/server'
import { getSession, canAccess } from '@/lib/auth'
import { runHealthCheck } from '@/lib/services/health-check'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccess(session.role, 'MANAGER')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const health = await runHealthCheck()
    return NextResponse.json(health)
  } catch (err) {
    console.error('[admin/health]', err)
    return NextResponse.json({ error: 'Health check failed' }, { status: 500 })
  }
}
