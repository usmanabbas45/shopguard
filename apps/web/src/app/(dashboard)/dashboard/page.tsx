import { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { generateDashboardStats, generateDemoIncidents } from '@/lib/demo-data'
import DashboardClient from './DashboardClient'
import { getDb } from '@/lib/db'
import { transactions, incidents } from '@shopguard/database'
import { eq, gte, and, count, sum, desc } from 'drizzle-orm'

export const metadata: Metadata = { title: 'Dashboard | ShopGuard' }
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const session = await getSession()
  let stats = { todaySales: 0, highPriorityCount: 0, mediumPriorityCount: 0, unreviewedCount: 0, transactionCount: 0, currency: 'USD' }
  let recentIncidents: unknown[] = []

  if (session?.isDemo) {
    return <DashboardClient initialStats={generateDashboardStats()} initialIncidents={generateDemoIncidents()} isDemo={true} />
  }

  if (session?.organizationId) {
    try {
      const db = getDb()
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const [txStats] = await db
        .select({ total: sum(transactions.grossAmount), cnt: count() })
        .from(transactions)
        .where(and(
          eq(transactions.organizationId, session.organizationId),
          gte(transactions.timestamp, today),
          eq(transactions.isDemo, false)
        ))

      const [incStats] = await db
        .select({ cnt: count() })
        .from(incidents)
        .where(and(
          eq(incidents.organizationId, session.organizationId),
          eq(incidents.status, 'OPEN')
        ))

      const recent = await db
        .select()
        .from(incidents)
        .where(eq(incidents.organizationId, session.organizationId))
        .orderBy(desc(incidents.createdAt))
        .limit(5)

      stats = {
        todaySales: Number(txStats?.total ?? 0),
        transactionCount: Number(txStats?.cnt ?? 0),
        highPriorityCount: 0,
        mediumPriorityCount: 0,
        unreviewedCount: Number(incStats?.cnt ?? 0),
        currency: 'PKR',
      }
      recentIncidents = recent
    } catch (e) {
      console.error('Dashboard DB error:', e)
    }
  }

  return <DashboardClient initialStats={stats} initialIncidents={recentIncidents} isDemo={false} />
}
