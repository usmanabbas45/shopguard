import { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { generateDashboardStats, generateDemoIncidents } from '@/lib/demo-data'
import DashboardClient from './DashboardClient'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const session = await getSession()

  let stats = null
  let recentIncidents: ReturnType<typeof generateDemoIncidents> = []

  if (session?.isDemo) {
    stats = generateDashboardStats()
    recentIncidents = generateDemoIncidents()
  } else if (session) {
    // Will be fetched client-side for real orgs (avoid SSR DB issues in this deploy)
    stats = { todaySales: 0, highPriorityCount: 0, mediumPriorityCount: 0, unreviewedCount: 0, transactionCount: 0, currency: 'PKR' }
  }

  return <DashboardClient initialStats={stats} initialIncidents={recentIncidents} isDemo={session?.isDemo ?? false} />
}
