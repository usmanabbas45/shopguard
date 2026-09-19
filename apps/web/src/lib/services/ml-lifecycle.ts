/**
 * ShopGuard ML Lifecycle Service
 * Drift detection, model monitoring, and retraining triggers.
 */

import { getDb } from '../db'
import { transactions, featureSnapshots, modelVersions } from '@shopguard/database'
import { eq, and, gte, sql } from 'drizzle-orm'

export interface DriftResult {
  hasDrift: boolean
  metrics: Record<string, { current: number; baseline: number; drift: number }>
  severity: 'none' | 'warning' | 'critical'
  recommendation: string
}

export async function checkFeatureDrift(orgId: string): Promise<DriftResult> {
  const db = getDb()

  // Compare recent 7 days vs previous 30 days
  const now = new Date()
  const recent7dStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const baseline30dStart = new Date(now.getTime() - 37 * 24 * 60 * 60 * 1000)

  const [recent] = await db
    .select({
      avgAmount: sql<number>`coalesce(avg(net_amount::numeric), 0)`,
      voidRate: sql<number>`count(*) filter (where is_void)::float / greatest(count(*), 1)`,
      refundRate: sql<number>`count(*) filter (where is_refund)::float / greatest(count(*), 1)`,
      discountRate: sql<number>`count(*) filter (where discount_amount::numeric > 0)::float / greatest(count(*), 1)`,
      txPerHour: sql<number>`count(*)::float / greatest(extract(epoch from (max(timestamp) - min(timestamp)))/3600, 1)`,
      txCount: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(and(
      eq(transactions.organizationId, orgId),
      gte(transactions.timestamp, recent7dStart),
      eq(transactions.isDemo, false)
    ))

  const [baseline] = await db
    .select({
      avgAmount: sql<number>`coalesce(avg(net_amount::numeric), 0)`,
      voidRate: sql<number>`count(*) filter (where is_void)::float / greatest(count(*), 1)`,
      refundRate: sql<number>`count(*) filter (where is_refund)::float / greatest(count(*), 1)`,
      discountRate: sql<number>`count(*) filter (where discount_amount::numeric > 0)::float / greatest(count(*), 1)`,
      txPerHour: sql<number>`count(*)::float / greatest(extract(epoch from (max(timestamp) - min(timestamp)))/3600, 1)`,
      txCount: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(and(
      eq(transactions.organizationId, orgId),
      gte(transactions.timestamp, baseline30dStart),
      eq(transactions.isDemo, false)
    ))

  if (!recent || !baseline || Number(baseline.txCount) < 100) {
    return {
      hasDrift: false,
      metrics: {},
      severity: 'none',
      recommendation: 'Insufficient data for drift detection',
    }
  }

  // Calculate relative drift for each metric
  function relDrift(current: number, base: number): number {
    if (base === 0) return 0
    return Math.abs(current - base) / base
  }

  const metrics = {
    avgAmount: {
      current: Number(recent.avgAmount),
      baseline: Number(baseline.avgAmount),
      drift: relDrift(Number(recent.avgAmount), Number(baseline.avgAmount)),
    },
    voidRate: {
      current: Number(recent.voidRate),
      baseline: Number(baseline.voidRate),
      drift: relDrift(Number(recent.voidRate), Number(baseline.voidRate)),
    },
    refundRate: {
      current: Number(recent.refundRate),
      baseline: Number(baseline.refundRate),
      drift: relDrift(Number(recent.refundRate), Number(baseline.refundRate)),
    },
    discountRate: {
      current: Number(recent.discountRate),
      baseline: Number(baseline.discountRate),
      drift: relDrift(Number(recent.discountRate), Number(baseline.discountRate)),
    },
    txPerHour: {
      current: Number(recent.txPerHour),
      baseline: Number(baseline.txPerHour),
      drift: relDrift(Number(recent.txPerHour), Number(baseline.txPerHour)),
    },
  }

  const maxDrift = Math.max(...Object.values(metrics).map(m => m.drift))
  const driftingMetrics = Object.entries(metrics).filter(([, m]) => m.drift > 0.3)

  let severity: 'none' | 'warning' | 'critical' = 'none'
  let hasDrift = false
  let recommendation = 'Feature distributions are stable'

  if (maxDrift > 0.5) {
    severity = 'critical'
    hasDrift = true
    recommendation = `Significant drift detected in ${driftingMetrics.map(([k]) => k).join(', ')}. Consider retraining the model.`
  } else if (maxDrift > 0.3) {
    severity = 'warning'
    hasDrift = true
    recommendation = `Moderate drift detected. Monitor closely. Retraining may improve accuracy.`
  }

  return { hasDrift, metrics, severity, recommendation }
}

export async function getProductionModel(orgId?: string) {
  const db = getDb()
  // Check ML service for production model info
  const mlUrl = process.env.ML_SERVICE_URL
  if (!mlUrl) return null

  try {
    const res = await fetch(`${mlUrl}/models`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    const data = await res.json()
    return data.models?.find((m: { status: string }) => m.status === 'PRODUCTION') ?? null
  } catch {
    return null
  }
}
