/**
 * ShopGuard System Health Check
 * Checks all major components and returns structured status.
 */

import { getDb } from '../db'
import { getRedis, getQueueStats } from '../queue/index'

export interface ComponentHealth {
  status: 'healthy' | 'warning' | 'critical'
  latencyMs?: number
  detail?: string
  lastChecked: string
}

export interface SystemHealth {
  overall: 'healthy' | 'warning' | 'critical'
  components: Record<string, ComponentHealth>
  timestamp: string
}

export async function runHealthCheck(): Promise<SystemHealth> {
  const components: Record<string, ComponentHealth> = {}
  const now = new Date().toISOString()

  // 1. Database
  try {
    const t = Date.now()
    const db = getDb()
    const { sql } = await import('drizzle-orm')
    await db.execute(sql`SELECT 1`)
    components.database = { status: 'healthy', latencyMs: Date.now() - t, lastChecked: now }
  } catch (err) {
    components.database = { status: 'critical', detail: err instanceof Error ? err.message : 'Connection failed', lastChecked: now }
  }

  // 2. Redis
  try {
    const redis = getRedis()
    if (!redis) {
      components.redis = { status: 'warning', detail: 'Redis not configured', lastChecked: now }
    } else {
      const t = Date.now()
      await redis.ping()
      components.redis = { status: 'healthy', latencyMs: Date.now() - t, lastChecked: now }
    }
  } catch (err) {
    components.redis = { status: 'warning', detail: 'Redis unavailable — jobs run inline', lastChecked: now }
  }

  // 3. ML Service
  try {
    const mlUrl = process.env.ML_SERVICE_URL
    if (!mlUrl) {
      components.ml = { status: 'warning', detail: 'ML_SERVICE_URL not configured — using rules+baselines', lastChecked: now }
    } else {
      const t = Date.now()
      const res = await fetch(`${mlUrl}/health`, { signal: AbortSignal.timeout(3000) })
      const data = await res.json()
      components.ml = {
        status: data.status === 'healthy' ? 'healthy' : 'warning',
        latencyMs: Date.now() - t,
        detail: data.modelStatus === 'no_model' ? 'No production model deployed' : `Model: ${data.modelId}`,
        lastChecked: now,
      }
    }
  } catch {
    components.ml = { status: 'warning', detail: 'ML service unreachable — graceful fallback active', lastChecked: now }
  }

  // 4. Job Queues
  try {
    const stats = await getQueueStats()
    const totalFailed = Object.values(stats).reduce((s, q) => s + (q.failed ?? 0), 0)
    const hasActive = Object.values(stats).some(q => (q.active ?? 0) > 0)

    if (components.redis?.status === 'critical') {
      components.workers = { status: 'critical', detail: 'Redis unavailable', lastChecked: now }
    } else if (totalFailed > 100) {
      components.workers = { status: 'warning', detail: `${totalFailed} failed jobs`, lastChecked: now }
    } else {
      components.workers = {
        status: 'healthy',
        detail: hasActive ? 'Workers processing' : 'Idle',
        lastChecked: now,
      }
    }
  } catch {
    components.workers = { status: 'warning', detail: 'Queue stats unavailable', lastChecked: now }
  }

  // 5. Storage (basic check)
  components.storage = { status: 'healthy', detail: 'Local filesystem', lastChecked: now }

  // 6. Notifications
  const hasSmtp = !!process.env.SMTP_HOST
  const hasWhatsApp = !!process.env.WHATSAPP_TOKEN
  components.notifications = {
    status: hasSmtp || hasWhatsApp ? 'healthy' : 'warning',
    detail: hasSmtp ? 'Email configured' : hasWhatsApp ? 'WhatsApp configured' : 'Using mock provider (dev mode)',
    lastChecked: now,
  }

  // Overall status
  const statuses = Object.values(components).map(c => c.status)
  let overall: 'healthy' | 'warning' | 'critical' = 'healthy'
  if (statuses.includes('critical')) overall = 'critical'
  else if (statuses.includes('warning')) overall = 'warning'

  return { overall, components, timestamp: now }
}
