import { Metadata } from 'next'
import { getSession } from '@/lib/auth'
import { generateDashboardStats, generateDemoIncidents } from '@/lib/demo-data'
import DashboardClient from './DashboardClient'

export const metadata: Metadata = { title: 'Dashboard | ShopGuard' }
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const session = await getSession()
  let stats: Record<string, unknown> = {}
  let recentIncidents: unknown[] = []

  if (session?.isDemo) {
    stats = generateDashboardStats()
    recentIncidents = generateDemoIncidents()
  } else if (session) {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://shopguard-web.vercel.app'
      const res = await fetch(`${baseUrl}/api/dashboard`, {
        headers: { Cookie: `sg_session=${session.token}` },
        cache: 'no-store',
      })
      if (res.ok) {
        const data = await res.json()
        stats = data.stats ?? {}
        recentIncidents = data.recentIncidents ?? []
      }
    } catch {
      // Fallback to empty — client will retry
    }
  }

  return <DashboardClient initialStats={stats} initialIncidents={recentIncidents} isDemo={session?.isDemo ?? false} />
}
