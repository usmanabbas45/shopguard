/**
 * ShopGuard Worker Process
 *
 * Single Node.js process that runs all BullMQ workers.
 * Start with: node -r tsx/esm src/lib/workers/runner.ts
 * Or via: pnpm worker
 *
 * In production, this runs as a separate container/process from the web app.
 * In development, it can run alongside Next.js.
 *
 * Each worker is independent. One worker failing doesn't crash others.
 */

import { Worker, type Job } from 'bullmq'
import { getRedis, QUEUE_NAMES } from '../queue/index'
import { getDb } from '../db'
import { analysisJobs, jobLogs } from '@shopguard/database'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

// ==================== WORKER REGISTRY ====================

const activeWorkers: Worker[] = []

function logJob(level: 'info' | 'warn' | 'error', jobType: string, jobId: string, msg: string, meta?: unknown) {
  const ts = new Date().toISOString()
  console.log(JSON.stringify({ ts, level, jobType, jobId, msg, meta }))
}

async function recordJobLog(opts: {
  organizationId?: string
  jobType: string
  jobId: string
  status: string
  payload?: unknown
  result?: unknown
  error?: string
  durationMs?: number
}) {
  try {
    const db = getDb()
    await db.insert(jobLogs).values({
      id: nanoid(),
      organizationId: opts.organizationId ?? null,
      jobType: opts.jobType,
      jobId: opts.jobId,
      status: opts.status,
      payload: opts.payload as Record<string, unknown> ?? null,
      result: opts.result as Record<string, unknown> ?? null,
      error: opts.error ?? null,
      durationMs: opts.durationMs ?? null,
      startedAt: new Date(),
      completedAt: opts.status === 'completed' || opts.status === 'failed' ? new Date() : null,
    })
  } catch (err) {
    console.error('[worker] Failed to record job log:', err)
  }
}

// ==================== ANALYSIS WORKER ====================

async function processAnalysisJob(job: Job): Promise<{ analyzed: number; incidents: number }> {
  const { organizationId, transactionIds, importJobId, idempotencyKey } = job.data
  const start = Date.now()

  logJob('info', 'analysis', job.id!, `Processing ${transactionIds?.length ?? 0} transactions`, { organizationId, importJobId })

  const { analyzeTransactionBatch, analyzeImportedTransactions } = await import('../services/analysis-pipeline')

  let result: { analyzed: number; incidentsCreated: number }

  if (importJobId && !transactionIds?.length) {
    result = await analyzeImportedTransactions(organizationId, importJobId)
  } else {
    result = await analyzeTransactionBatch(organizationId, transactionIds ?? [])
  }

  logJob('info', 'analysis', job.id!, `Analysis complete: ${result.analyzed} analyzed, ${result.incidentsCreated} incidents`, { durationMs: Date.now() - start })

  return { analyzed: result.analyzed, incidents: result.incidentsCreated }
}

// ==================== BASELINE WORKER ====================

async function processBaselineJob(job: Job): Promise<{ employees: number; stores: number; registers: number }> {
  const { organizationId, scope, entityId, periods } = job.data
  const start = Date.now()

  logJob('info', 'baseline', job.id!, `Recalculating baselines`, { organizationId, scope })

  const { recalculateAllBaselines, calculateEmployeeBaselines, calculateStoreBaselines } = await import('../services/baseline-engine')

  let result = { employees: 0, stores: 0, registers: 0 }

  if (scope === 'all') {
    result = await recalculateAllBaselines(organizationId, periods ?? ['rolling_7d', 'rolling_30d', 'rolling_60d'])
  } else if (scope === 'employee' && entityId) {
    for (const period of (periods ?? ['rolling_30d'])) {
      await calculateEmployeeBaselines(organizationId, entityId, period as 'rolling_30d')
    }
    result.employees = 1
  } else if (scope === 'store' && entityId) {
    for (const period of (periods ?? ['rolling_30d'])) {
      await calculateStoreBaselines(organizationId, entityId, period as 'rolling_30d')
    }
    result.stores = 1
  }

  logJob('info', 'baseline', job.id!, `Baselines updated in ${Date.now() - start}ms`, result)
  return result
}

// ==================== NOTIFICATION WORKER ====================

async function processNotificationJob(job: Job): Promise<{ sent: boolean }> {
  const { incidentId, organizationId, type, idempotencyKey } = job.data
  const start = Date.now()

  logJob('info', 'notification', job.id!, `Sending ${type} for incident ${incidentId}`)

  const { sendIncidentNotification } = await import('../services/notification-engine')
  await sendIncidentNotification(incidentId, type)

  logJob('info', 'notification', job.id!, `Notification sent in ${Date.now() - start}ms`)
  return { sent: true }
}

// ==================== FOLLOWUP WORKER ====================

async function processFollowupJob(job: Job): Promise<{ processed: number }> {
  const { organizationId } = job.data
  logJob('info', 'followup', job.id!, `Processing follow-ups`, { organizationId })

  const { processFollowUps } = await import('../services/notification-engine')
  const sent = await processFollowUps()

  logJob('info', 'followup', job.id!, `Follow-ups processed: ${sent} sent`)
  return { processed: sent }
}

// ==================== REPORT WORKER ====================

async function processReportJob(job: Job): Promise<{ generated: boolean }> {
  const { organizationId, date, timezone } = job.data
  logJob('info', 'report', job.id!, `Generating daily report for ${date}`, { organizationId, timezone })

  const { generateDailyReport } = await import('../services/report-engine')
  await generateDailyReport(organizationId, date, timezone)

  return { generated: true }
}

// ==================== ML WORKER ====================

async function processMLJob(job: Job): Promise<{ result: string }> {
  const { organizationId, action } = job.data
  logJob('info', 'ml', job.id!, `ML job: ${action}`, { organizationId })

  if (action === 'drift_check') {
    const { checkFeatureDrift } = await import('../services/ml-lifecycle')
    await checkFeatureDrift(organizationId)
    return { result: 'drift_checked' }
  }

  return { result: 'noop' }
}

// ==================== QUALITY WORKER ====================

async function processQualityJob(job: Job): Promise<{ issues: number }> {
  const { organizationId, importJobId } = job.data
  logJob('info', 'quality', job.id!, `Running data quality checks`, { organizationId })

  const { runDataQualityChecks } = await import('../services/data-quality')
  const issues = await runDataQualityChecks(organizationId, importJobId)

  return { issues }
}

// ==================== HEALTH WORKER ====================

async function processHealthJob(job: Job): Promise<{ healthy: boolean }> {
  logJob('info', 'health', job.id!, 'Running system health check')
  const { runHealthCheck } = await import('../services/health-check')
  const result = await runHealthCheck()
  return { healthy: result.overall === 'healthy' }
}

// ==================== WORKER SETUP ====================

const WORKER_MAP: Record<string, (job: Job) => Promise<unknown>> = {
  [QUEUE_NAMES.ANALYSIS]: processAnalysisJob,
  [QUEUE_NAMES.BASELINE]: processBaselineJob,
  [QUEUE_NAMES.NOTIFICATION]: processNotificationJob,
  [QUEUE_NAMES.FOLLOWUP]: processFollowupJob,
  [QUEUE_NAMES.REPORT]: processReportJob,
  [QUEUE_NAMES.ML]: processMLJob,
  [QUEUE_NAMES.QUALITY]: processQualityJob,
  [QUEUE_NAMES.HEALTH]: processHealthJob,
}

export async function startWorkers(): Promise<void> {
  const redis = getRedis()
  if (!redis) {
    console.warn('[worker] Redis unavailable — workers not started. Jobs run inline.')
    return
  }

  // Wait for Redis to be ready
  try {
    await redis.ping()
  } catch (err) {
    console.warn('[worker] Redis ping failed — workers not started:', err)
    return
  }

  for (const [queueName, handler] of Object.entries(WORKER_MAP)) {
    const worker = new Worker(
      queueName,
      async (job: Job) => {
        const start = Date.now()
        await recordJobLog({
          organizationId: job.data?.organizationId,
          jobType: queueName,
          jobId: job.id!,
          status: 'running',
          payload: job.data,
        })
        try {
          const result = await handler(job)
          await recordJobLog({
            organizationId: job.data?.organizationId,
            jobType: queueName,
            jobId: job.id!,
            status: 'completed',
            result: result as Record<string, unknown>,
            durationMs: Date.now() - start,
          })
          return result
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err)
          console.error(`[worker:${queueName}] Job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}):`, error)
          await recordJobLog({
            organizationId: job.data?.organizationId,
            jobType: queueName,
            jobId: job.id!,
            status: job.attemptsMade >= (job.opts.attempts ?? 3) - 1 ? 'dead_letter' : 'failed',
            error,
            durationMs: Date.now() - start,
          })
          throw err // Re-throw so BullMQ can retry
        }
      },
      {
        connection: redis,
        concurrency: 2,
        maxStalledCount: 3,
      }
    )

    worker.on('failed', (job, err) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
        console.error(`[worker:${queueName}] Job ${job.id} moved to dead letter after ${job.attemptsMade} attempts`)
      }
    })

    activeWorkers.push(worker)
    console.log(`[worker] Started worker for queue: ${queueName}`)
  }
}

export async function stopWorkers(): Promise<void> {
  await Promise.all(activeWorkers.map(w => w.close()))
  activeWorkers.length = 0
  console.log('[worker] All workers stopped')
}

// ==================== INLINE FALLBACK ====================
// When Redis is unavailable (development), run jobs synchronously

export async function runJobInline(queueName: string, data: unknown): Promise<unknown> {
  const handler = WORKER_MAP[queueName]
  if (!handler) throw new Error(`Unknown queue: ${queueName}`)
  return handler({ id: nanoid(), data, attemptsMade: 0, opts: { attempts: 1 } } as Job)
}
