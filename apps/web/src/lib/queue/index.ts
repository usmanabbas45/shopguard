/**
 * ShopGuard Queue System
 *
 * BullMQ-based durable job queues backed by Redis.
 * Falls back gracefully if Redis is unavailable (dev without Redis).
 *
 * Queues:
 *   IMPORT_QUEUE      — CSV row processing
 *   ANALYSIS_QUEUE    — Transaction anomaly analysis
 *   BASELINE_QUEUE    — Baseline recalculation
 *   NOTIFICATION_QUEUE — Send incident notifications
 *   FOLLOWUP_QUEUE    — Process follow-up reminders
 *   REPORT_QUEUE      — Generate daily reports
 *   ML_QUEUE          — ML training/evaluation
 *   HEALTH_QUEUE      — System health checks
 *   QUALITY_QUEUE     — Data quality checks
 */

import { Queue, QueueOptions } from 'bullmq'
import IORedis from 'ioredis'

// ==================== REDIS CONNECTION ====================

let _redis: IORedis | null = null
let _redisAvailable: boolean | null = null

export function getRedis(): IORedis | null {
  if (_redis) return _redis
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
  try {
    _redis = new IORedis(url, {
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
      lazyConnect: true,
    })
    _redis.on('error', (err) => {
      // Don't crash on Redis errors — log and continue
      if (_redisAvailable !== false) {
        console.warn('[queue] Redis error:', err.message)
        _redisAvailable = false
      }
    })
    _redis.on('connect', () => {
      if (_redisAvailable !== true) {
        console.log('[queue] Redis connected')
        _redisAvailable = true
      }
    })
    return _redis
  } catch (err) {
    console.warn('[queue] Redis connection failed:', err)
    return null
  }
}

export function isRedisAvailable(): boolean {
  return _redisAvailable === true
}

// ==================== QUEUE NAMES ====================

export const QUEUE_NAMES = {
  IMPORT: 'sg-import',
  ANALYSIS: 'sg-analysis',
  BASELINE: 'sg-baseline',
  NOTIFICATION: 'sg-notification',
  FOLLOWUP: 'sg-followup',
  REPORT: 'sg-report',
  ML: 'sg-ml',
  HEALTH: 'sg-health',
  QUALITY: 'sg-quality',
  SHOPIFY_SYNC: 'sg-shopify-sync',  // Shopify historical/incremental sync batches
} as const

// ==================== QUEUE FACTORY ====================

const _queues = new Map<string, Queue>()

function sharedQueueOptions(): Partial<QueueOptions> {
  return {
    defaultJobOptions: {
      removeOnComplete: 100, // Keep last 100 completed
      removeOnFail: 500,     // Keep last 500 failed for debugging
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000, // 5s, 10s, 20s
      },
    },
  }
}

export function getQueue(name: string): Queue | null {
  const redis = getRedis()
  if (!redis) return null

  if (_queues.has(name)) return _queues.get(name)!

  const queue = new Queue(name, {
    connection: redis,
    ...sharedQueueOptions(),
  })

  _queues.set(name, queue)
  return queue
}

// ==================== JOB TYPES ====================

export interface ImportJobData {
  jobId: string        // analysisJobs.id for idempotency
  organizationId: string
  importJobId: string
  storeId?: string
  idempotencyKey: string
}

export interface AnalysisJobData {
  organizationId: string
  transactionIds: string[]
  importJobId?: string
  idempotencyKey: string  // orgId + importJobId or specific tx batch hash
}

export interface BaselineJobData {
  organizationId: string
  scope: 'all' | 'employee' | 'store' | 'register'
  entityId?: string
  periods?: string[]
  idempotencyKey: string
}

export interface NotificationJobData {
  incidentId: string
  organizationId: string
  type: 'INCIDENT_CREATED' | 'INCIDENT_FOLLOWUP' | 'INCIDENT_ESCALATION' | 'DAILY_REPORT'
  idempotencyKey: string  // incidentId + type + scheduledAt_hour
  retryCount?: number
}

export interface FollowupJobData {
  organizationId: string
  idempotencyKey: string  // orgId + date_hour
}

export interface ReportJobData {
  organizationId: string
  date: string // ISO date
  timezone: string
  idempotencyKey: string
}

export interface MLJobData {
  organizationId: string
  action: 'train' | 'evaluate' | 'drift_check'
  idempotencyKey: string
}

export interface QualityJobData {
  organizationId: string
  importJobId?: string
  idempotencyKey: string
}

export interface HealthJobData {
  idempotencyKey: string
}

// ==================== ENQUEUE HELPERS ====================

export async function enqueueAnalysis(data: AnalysisJobData): Promise<string | null> {
  const queue = getQueue(QUEUE_NAMES.ANALYSIS)
  if (!queue) {
    // No Redis — run inline (dev mode)
    console.log('[queue] Redis unavailable, running analysis inline')
    return null
  }
  const job = await queue.add('analyze', data, {
    jobId: data.idempotencyKey, // BullMQ deduplicates by jobId
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  })
  return job.id ?? null
}

export async function enqueueBaseline(data: BaselineJobData): Promise<string | null> {
  const queue = getQueue(QUEUE_NAMES.BASELINE)
  if (!queue) return null
  const job = await queue.add('baseline', data, {
    jobId: data.idempotencyKey,
    priority: 10, // Lower priority than analysis
  })
  return job.id ?? null
}

export async function enqueueNotification(data: NotificationJobData): Promise<string | null> {
  const queue = getQueue(QUEUE_NAMES.NOTIFICATION)
  if (!queue) return null
  const job = await queue.add('notify', data, {
    jobId: data.idempotencyKey,
    attempts: 5,
    backoff: { type: 'exponential', delay: 10000 },
  })
  return job.id ?? null
}

export async function enqueueFollowup(data: FollowupJobData): Promise<string | null> {
  const queue = getQueue(QUEUE_NAMES.FOLLOWUP)
  if (!queue) return null
  const job = await queue.add('followup', data, {
    jobId: data.idempotencyKey,
  })
  return job.id ?? null
}

export async function enqueueReport(data: ReportJobData): Promise<string | null> {
  const queue = getQueue(QUEUE_NAMES.REPORT)
  if (!queue) return null
  const job = await queue.add('report', data, {
    jobId: data.idempotencyKey,
  })
  return job.id ?? null
}

export async function enqueueMLJob(data: MLJobData): Promise<string | null> {
  const queue = getQueue(QUEUE_NAMES.ML)
  if (!queue) return null
  const job = await queue.add('ml', data, {
    jobId: data.idempotencyKey,
    priority: 20, // Lowest priority
    attempts: 2,
  })
  return job.id ?? null
}

export async function enqueueQuality(data: QualityJobData): Promise<string | null> {
  const queue = getQueue(QUEUE_NAMES.QUALITY)
  if (!queue) return null
  const job = await queue.add('quality', data, {
    jobId: data.idempotencyKey,
    priority: 15,
  })
  return job.id ?? null
}

// ==================== QUEUE STATUS ====================

export async function getQueueStats(): Promise<Record<string, {
  waiting: number; active: number; completed: number; failed: number; delayed: number
}>> {
  const stats: Record<string, { waiting: number; active: number; completed: number; failed: number; delayed: number }> = {}

  for (const [name, queueName] of Object.entries(QUEUE_NAMES)) {
    const queue = getQueue(queueName)
    if (!queue) {
      stats[name] = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }
      continue
    }
    try {
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed')
      stats[name] = counts as typeof stats[string]
    } catch {
      stats[name] = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }
    }
  }

  return stats
}

// ==================== INLINE FALLBACK ====================
// When Redis unavailable (dev), run jobs synchronously

export async function runJobInline(queueName: string, data: unknown): Promise<unknown> {
  // Dynamic import to avoid circular dependencies
  const { runJobInline: _run } = await import('../workers/runner')
  return _run(queueName, data)
}

// ==================== SHOPIFY SYNC QUEUE ====================

export interface ShopifySyncJobData {
  integrationId: string
  organizationId: string
  /** Idempotency key — prevents BullMQ duplicate jobs for same integration */
  idempotencyKey: string
}

/**
 * Enqueue a Shopify initial (or resume) sync job.
 *
 * Consumer paths on Vercel (no persistent worker):
 *   1. Vercel Cron (/api/cron/process-jobs every 5 min) reads DB syncStatus='QUEUED'
 *   2. Manual "Sync now" also runs one batch inline immediately
 *
 * Consumer paths on standalone worker (Docker/Render):
 *   1. BullMQ Worker listening on 'sg-shopify-sync'
 *
 * Idempotency: jobId = idempotencyKey → BullMQ deduplicates if same key queued twice.
 * DB syncStatus='QUEUED' is the durable fallback signal (survives Redis restart).
 */
export async function enqueueShopifySync(data: ShopifySyncJobData): Promise<string | null> {
  const queue = getQueue(QUEUE_NAMES.SHOPIFY_SYNC)
  if (queue) {
    try {
      const job = await queue.add('shopify-sync', data, {
        jobId: data.idempotencyKey,
        attempts: 5,
        backoff: { type: 'exponential', delay: 10000 },
      })
      return job.id ?? null
    } catch (err: unknown) {
      const msg = String(err)
      if (msg.includes('already exists') || msg.includes('duplicate')) return 'deduplicated'
      console.error('[queue] Failed to enqueue Shopify sync:', msg.slice(0, 100))
    }
  }
  // No Redis — cron will pick up via DB syncStatus='QUEUED'
  return null
}

