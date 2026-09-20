import { NextResponse } from 'next/server'

export async function GET() {
  const checks: Record<string, { status: string; latencyMs?: number; detail?: string }> = {}
  const start = Date.now()

  // Database check — also wakes Neon if suspended
  try {
    const db = (await import('@/lib/db')).getDb()
    const { sql } = await import('drizzle-orm')
    await db.execute(sql`SELECT 1`)
    checks.database = { status: 'healthy', latencyMs: Date.now() - start }
  } catch {
    checks.database = { status: 'critical', detail: 'Connection failed' }
  }

  const allHealthy = Object.values(checks).every(c => c.status === 'healthy')
  return NextResponse.json(
    { status: allHealthy ? 'healthy' : 'degraded', checks, timestamp: new Date().toISOString() },
    { status: allHealthy ? 200 : 503 }
  )
}
