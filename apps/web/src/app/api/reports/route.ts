import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (session.isDemo) {
      // Return structured demo report data
      return NextResponse.json({
        isDemo: true,
        latestReport: {
          date: new Date().toISOString().split('T')[0],
          title: "Today's Daily Report",
          summary: {
            sales: 487250, txCount: 342, voidCount: 8, refundCount: 5,
            incidents: { total: 7, high: 3, open: 5 },
            currency: 'PKR', generatedAt: new Date().toISOString(),
          },
          isGenerated: true,
        },
        previousReports: [
          { id: 'demo-r1', date: new Date(Date.now() - 86400000).toISOString().split('T')[0], title: "Yesterday's Summary", type: 'DAILY' },
          { id: 'demo-r2', date: new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0], title: "Daily Report", type: 'DAILY' },
        ],
      })
    }

    const db = (await import('@/lib/db')).getDb()
    const { reports } = await import('@shopguard/database')
    const { eq, and, desc } = await import('drizzle-orm')

    const orgId = session.organizationId

    // Latest report
    const [latestReport] = await db
      .select()
      .from(reports)
      .where(and(eq(reports.organizationId, orgId), eq(reports.type, 'DAILY'), eq(reports.isDemo, false)))
      .orderBy(desc(reports.date))
      .limit(1)

    // Previous reports list
    const previousReports = await db
      .select({ id: reports.id, date: reports.date, title: reports.title, type: reports.type })
      .from(reports)
      .where(and(eq(reports.organizationId, orgId), eq(reports.isDemo, false)))
      .orderBy(desc(reports.date))
      .limit(30)

    return NextResponse.json({ isDemo: false, latestReport: latestReport ?? null, previousReports })
  } catch (err) {
    console.error('[reports]', err)
    return NextResponse.json({ error: 'Failed to load reports' }, { status: 500 })
  }
}
