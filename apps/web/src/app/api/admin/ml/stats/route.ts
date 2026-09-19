import { NextResponse } from 'next/server'
import { getSession, canAccess } from '@/lib/auth'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccess(session.role, 'ADMIN')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const db = (await import('@/lib/db')).getDb()
    const { incidents, incidentReviews, transactions } = await import('@shopguard/database')
    const { eq, and, sql } = await import('drizzle-orm')

    const orgId = session.organizationId

    const [incidentStats] = await db
      .select({
        total: sql<number>`count(*)`,
        open: sql<number>`count(*) filter (where status = 'OPEN')`,
        reviewed: sql<number>`count(*) filter (where status in ('RESOLVED','DISMISSED'))`,
      })
      .from(incidents)
      .where(and(eq(incidents.organizationId, orgId), eq(incidents.isDemo, false)))

    // SECURITY: join through incidents to scope reviews to this organization only
    const [reviewStats] = await db
      .select({
        total: sql<number>`count(*)`,
        valid: sql<number>`count(*) filter (where ir.label = 'VALID_INCIDENT')`,
        falsePositive: sql<number>`count(*) filter (where ir.label = 'FALSE_POSITIVE')`,
        needsInvestigation: sql<number>`count(*) filter (where ir.label = 'NEEDS_INVESTIGATION')`,
      })
      .from(incidentReviews)
      // Join to incidents to enforce org scope
      .innerJoin(incidents, eq(incidents.id, incidentReviews.incidentId))
      .where(eq(incidents.organizationId, orgId))

    const [txStats] = await db
      .select({ total: sql<number>`count(*)` })
      .from(transactions)
      .where(and(eq(transactions.organizationId, orgId), eq(transactions.isDemo, false)))

    let models: unknown[] = []
    const mlUrl = process.env.ML_SERVICE_URL
    if (mlUrl) {
      try {
        const res = await fetch(`${mlUrl}/models`, { signal: AbortSignal.timeout(3000) })
        if (res.ok) {
          const data = await res.json()
          models = data.models ?? []
        }
      } catch {}
    }

    return NextResponse.json({
      stats: {
        reviewedIncidents: Number(reviewStats?.total ?? 0),
        validIncidents: Number(reviewStats?.valid ?? 0),
        falsePositives: Number(reviewStats?.falsePositive ?? 0),
        openIncidents: Number(incidentStats?.open ?? 0),
        totalTransactions: Number(txStats?.total ?? 0),
      },
      models,
    })
  } catch (err) {
    console.error('[admin/ml/stats]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
