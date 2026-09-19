import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateDashboardStats, generateDemoIncidents } from '@/lib/demo-data'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (session.isDemo) {
      const stats = generateDashboardStats()
      const incidents = generateDemoIncidents()
      return NextResponse.json({ stats, recentIncidents: incidents.slice(0, 5), isDemo: true })
    }

    const db = (await import('@/lib/db')).getDb()
    const { incidents, transactions } = await import('@shopguard/database')
    const { eq, and, gte, desc, sql } = await import('drizzle-orm')

    const orgId = session.organizationId
    const today = new Date(); today.setHours(0, 0, 0, 0)

    const [txStats] = await db
      .select({
        totalSales: sql<number>`coalesce(sum(case when not is_void and not is_refund then net_amount::numeric else 0 end), 0)`,
        txCount: sql<number>`count(*)`,
        voidCount: sql<number>`count(*) filter (where is_void)`,
        refundCount: sql<number>`count(*) filter (where is_refund)`,
      })
      .from(transactions)
      .where(and(eq(transactions.organizationId, orgId), gte(transactions.timestamp, today), eq(transactions.isDemo, false)))

    const [incidentStats] = await db
      .select({
        highCount: sql<number>`count(*) filter (where risk_level = 'HIGH' and status = 'OPEN')`,
        mediumCount: sql<number>`count(*) filter (where risk_level = 'MEDIUM' and status = 'OPEN')`,
        unreviewedCount: sql<number>`count(*) filter (where status = 'OPEN')`,
        reviewedToday: sql<number>`count(*) filter (where status in ('RESOLVED','DISMISSED') and updated_at >= now() - interval '24 hours')`,
      })
      .from(incidents)
      .where(and(eq(incidents.organizationId, orgId), eq(incidents.isDemo, false)))

    const recentIncidents = await db
      .select()
      .from(incidents)
      .where(and(eq(incidents.organizationId, orgId), eq(incidents.isDemo, false), eq(incidents.status, 'OPEN')))
      .orderBy(desc(incidents.createdAt))
      .limit(5)

    return NextResponse.json({
      stats: {
        todaySales: Number(txStats?.totalSales ?? 0),
        highPriorityCount: Number(incidentStats?.highCount ?? 0),
        mediumPriorityCount: Number(incidentStats?.mediumCount ?? 0),
        unreviewedCount: Number(incidentStats?.unreviewedCount ?? 0),
        reviewedToday: Number(incidentStats?.reviewedToday ?? 0),
        transactionCount: Number(txStats?.txCount ?? 0),
        voidCount: Number(txStats?.voidCount ?? 0),
        refundCount: Number(txStats?.refundCount ?? 0),
        currency: 'PKR',
      },
      recentIncidents,
      isDemo: false,
    })
  } catch (err) {
    console.error('[dashboard]', err)
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
  }
}
