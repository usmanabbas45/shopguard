/**
 * ShopGuard Daily Scheduler
 *
 * Runs the daily automation workflow for each organization.
 * Uses node-cron for scheduling.
 *
 * DO NOT hard-code timezone. Respects each org's timezone.
 *
 * Daily workflow (06:00 each org's local time):
 * 1. Update baselines
 * 2. Process outstanding transactions
 * 3. Analyze anomalies
 * 4. Generate daily report
 * 5. Process follow-ups
 * 6. Run data quality checks
 * 7. Run ML drift check
 * 8. Record system health
 */

import cron from 'node-cron'
import { getDb } from '../db'
import { organizations, orgSettings } from '@shopguard/database'
import { eq } from 'drizzle-orm'
import {
  enqueueBaseline,
  enqueueReport,
  enqueueFollowup,
  enqueueMLJob,
  enqueueQuality,
  QUEUE_NAMES,
  runJobInline,
  getRedis,
} from '../queue/index'

let schedulerStarted = false

// UTC hours that correspond to 06:00 in common timezones
// In production: check every 30 min and compute per-org local time
const DAILY_RUN_HOUR = 6 // 06:00 local time

function getLocalHour(timezone: string): number {
  try {
    const now = new Date()
    const localTime = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).format(now)
    return parseInt(localTime, 10)
  } catch {
    return new Date().getUTCHours()
  }
}

function getTodayDate(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  } catch {
    return new Date().toISOString().split('T')[0]
  }
}

async function runDailyWorkflow(orgId: string, timezone: string): Promise<void> {
  const date = getTodayDate(timezone)
  console.log(`[scheduler] Running daily workflow for org ${orgId}, date ${date}, tz ${timezone}`)

  const useQueue = !!getRedis()

  // 1. Update baselines
  const baselineKey = `baseline:${orgId}:${date}`
  if (useQueue) {
    await enqueueBaseline({ organizationId: orgId, scope: 'all', idempotencyKey: baselineKey })
  } else {
    await runJobInline(QUEUE_NAMES.BASELINE, { organizationId: orgId, scope: 'all', idempotencyKey: baselineKey })
  }

  // 2. Follow-ups
  const followupKey = `followup:${orgId}:${date}:06`
  if (useQueue) {
    await enqueueFollowup({ organizationId: orgId, idempotencyKey: followupKey })
  } else {
    await runJobInline(QUEUE_NAMES.FOLLOWUP, { organizationId: orgId, idempotencyKey: followupKey })
  }

  // 3. Daily report
  const reportKey = `report:${orgId}:${date}`
  if (useQueue) {
    await enqueueReport({ organizationId: orgId, date, timezone, idempotencyKey: reportKey })
  } else {
    await runJobInline(QUEUE_NAMES.REPORT, { organizationId: orgId, date, timezone, idempotencyKey: reportKey })
  }

  // 4. Data quality
  const qualityKey = `quality:${orgId}:${date}`
  if (useQueue) {
    await enqueueQuality({ organizationId: orgId, idempotencyKey: qualityKey })
  } else {
    await runJobInline(QUEUE_NAMES.QUALITY, { organizationId: orgId, idempotencyKey: qualityKey })
  }

  // 5. ML drift check (weekly)
  const dayOfWeek = new Date().getDay()
  if (dayOfWeek === 1) { // Monday only
    const mlKey = `ml:drift:${orgId}:${date}`
    if (useQueue) {
      await enqueueMLJob({ organizationId: orgId, action: 'drift_check', idempotencyKey: mlKey })
    } else {
      await runJobInline(QUEUE_NAMES.ML, { organizationId: orgId, action: 'drift_check', idempotencyKey: mlKey })
    }
  }
}

export function startScheduler(): void {
  if (schedulerStarted) return
  schedulerStarted = true

  // Run every 30 minutes — check if any org's local time is 06:00
  cron.schedule('*/30 * * * *', async () => {
    try {
      const db = getDb()
      const orgs = await db
        .select({
          id: organizations.id,
          timezone: organizations.timezone,
          isActive: organizations.isActive,
          isDemo: organizations.isDemo,
        })
        .from(organizations)
        .where(eq(organizations.isActive, true))

      for (const org of orgs) {
        if (org.isDemo) continue // Skip demo orgs in scheduler
        const localHour = getLocalHour(org.timezone)
        if (localHour === DAILY_RUN_HOUR) {
          try {
            await runDailyWorkflow(org.id, org.timezone)
          } catch (err) {
            console.error(`[scheduler] Daily workflow failed for org ${org.id}:`, err)
          }
        }
      }
    } catch (err) {
      console.error('[scheduler] Cron job error:', err)
    }
  })

  // Follow-up check: every hour
  cron.schedule('0 * * * *', async () => {
    try {
      const db = getDb()
      const orgs = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.isActive, true))

      for (const org of orgs) {
        const hour = new Date().getUTCHours()
        const followupKey = `followup:${org.id}:${new Date().toISOString().split('T')[0]}:${hour}`
        if (getRedis()) {
          await enqueueFollowup({ organizationId: org.id, idempotencyKey: followupKey })
        } else {
          // Run inline without blocking
          runJobInline(QUEUE_NAMES.FOLLOWUP, { organizationId: org.id, idempotencyKey: followupKey }).catch(console.error)
        }
      }
    } catch (err) {
      console.error('[scheduler] Follow-up cron error:', err)
    }
  })

  // Health check: every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const hcKey = `health:${Math.floor(Date.now() / 300000)}`
      if (getRedis()) {
        await import('../queue/index').then(q => q.getQueue(q.QUEUE_NAMES.HEALTH)?.add('health', { idempotencyKey: hcKey }, { jobId: hcKey }))
      } else {
        // Silently run health check
        runJobInline(QUEUE_NAMES.HEALTH, { idempotencyKey: hcKey }).catch(() => {})
      }
    } catch {}
  })

  console.log('[scheduler] Daily scheduler started')
}

export function stopScheduler(): void {
  cron.getTasks().forEach(task => task.stop())
  schedulerStarted = false
  console.log('[scheduler] Scheduler stopped')
}
