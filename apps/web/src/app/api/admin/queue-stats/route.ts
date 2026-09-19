import { NextResponse } from 'next/server'
import { getSession, canAccess } from '@/lib/auth'
import { getQueueStats } from '@/lib/queue/index'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccess(session.role, 'MANAGER')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const stats = await getQueueStats()
    return NextResponse.json({ stats })
  } catch (err) {
    return NextResponse.json({ stats: {}, error: 'Stats unavailable' })
  }
}
