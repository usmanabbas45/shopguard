/**
 * ShopGuard Analysis Pipeline
 *
 * The core intelligence pipeline that processes transactions and produces incidents.
 *
 * Flow:
 * Transactions → Feature Generation → Rule Evaluation → Baseline Comparison
 * → Risk Aggregation → Incident Correlation → Incident Creation
 *
 * ML is called when available; falls back to rules+baselines gracefully.
 */

import { getDb } from '../db'
import {
  transactions, incidents, incidentEvidence, incidentTransactions,
  incidentRelations, analysisJobs, featureSnapshots, employees, stores,
} from '@shopguard/database'
import { eq, and, gte, lte, inArray, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { evaluateRisk, RULES, type RuleContext } from '../risk-engine'
import {
  getEmployeeBaseline, getStoreBaseline, getTimeBaseline,
  getRecentEmployeeTransactions, getNearbyRegisterTransactions,
} from './baseline-engine'
import type { Transaction, EmployeeBaseline, StoreBaseline } from '@shopguard/types'

// ==================== FEATURE GENERATION ====================

export interface TransactionFeatures {
  // Transaction-level
  amount: number
  logAmount: number
  itemCount: number
  discountPercent: number
  refundAmount: number
  grossAmount: number
  durationSeconds: number
  hour: number
  dayOfWeek: number
  paymentMethodCode: number // 0=cash 1=card 2=mobile 3=other
  afterHours: boolean
  isVoid: boolean
  isRefund: boolean
  isNoSale: boolean
  hasPriceOverride: boolean

  // Employee context (null when baseline not available)
  empTxPerHour: number | null
  empAvgAmount: number | null
  empVoidRate: number | null
  empRefundRate: number | null
  empDiscountRate: number | null
  empBaselineConfidence: string | null

  // Deviations (z-score style, null if no baseline)
  amountDeviationFromEmpBaseline: number | null
  amountDeviationFromStoreBaseline: number | null
  voidRateDeviationFromEmpBaseline: number | null

  // Store context
  storeAvgAmount: number | null
  storeVoidRate: number | null
  storeRefundRate: number | null
  storeBaselineConfidence: string | null

  // Time context
  hourlyAvgVolume: number | null
  hourlyAvgAmount: number | null
  featureVersion: string
}

function paymentMethodCode(method: string | null): number {
  if (!method) return 3
  const m = method.toLowerCase()
  if (m === 'cash') return 0
  if (m === 'card' || m.includes('credit') || m.includes('debit')) return 1
  if (m === 'mobile' || m.includes('jazz') || m.includes('easy') || m.includes('wallet')) return 2
  return 3
}

function zScore(value: number, mean: number, std: number): number | null {
  if (std === 0 || std === null || mean === null) return null
  return (value - mean) / std
}

export async function generateFeatures(
  orgId: string,
  tx: typeof transactions.$inferSelect
): Promise<TransactionFeatures> {
  const amount = Number(tx.netAmount)
  const hour = new Date(tx.timestamp).getHours()
  const dayOfWeek = new Date(tx.timestamp).getDay()

  // Fetch baselines (gracefully handle missing)
  const empBaseline = tx.employeeId
    ? await getEmployeeBaseline(orgId, tx.employeeId)
    : null

  const storeBaseline = await getStoreBaseline(orgId, tx.storeId)

  const timeBaseline = await getTimeBaseline(orgId, tx.storeId, hour, dayOfWeek)

  const empAvgAmount = empBaseline ? Number(empBaseline.avgAmount ?? 0) : null
  const empStdAmount = empBaseline ? Number(empBaseline.stdAmount ?? 0) : null
  const storeAvgAmount = storeBaseline ? Number(storeBaseline.avgAmount ?? 0) : null
  const storeStdAmount = storeBaseline ? Number(storeBaseline.stdAmount ?? 0) : null
  const empVoidRate = empBaseline ? Number(empBaseline.voidRate ?? 0) : null
  const storeVoidRate = storeBaseline ? Number(storeBaseline.voidRate ?? 0) : null

  return {
    amount,
    logAmount: amount > 0 ? Math.log(amount) : 0,
    itemCount: tx.itemCount ?? 0,
    discountPercent: Number(tx.discountPercent ?? 0),
    refundAmount: Number(tx.refundAmount ?? 0),
    grossAmount: Number(tx.grossAmount),
    durationSeconds: tx.durationSeconds ?? 0,
    hour,
    dayOfWeek,
    paymentMethodCode: paymentMethodCode(tx.paymentMethod),
    afterHours: hour < 8 || hour >= 22,
    isVoid: tx.isVoid,
    isRefund: tx.isRefund,
    isNoSale: tx.isNoSale,
    hasPriceOverride: tx.hasPriceOverride,

    empTxPerHour: empBaseline ? Number(empBaseline.txPerHour ?? 0) : null,
    empAvgAmount,
    empVoidRate,
    empRefundRate: empBaseline ? Number(empBaseline.refundRate ?? 0) : null,
    empDiscountRate: empBaseline ? Number(empBaseline.discountRate ?? 0) : null,
    empBaselineConfidence: empBaseline?.confidence ?? null,

    amountDeviationFromEmpBaseline:
      empAvgAmount !== null && empStdAmount !== null
        ? zScore(amount, empAvgAmount, empStdAmount)
        : null,
    amountDeviationFromStoreBaseline:
      storeAvgAmount !== null && storeStdAmount !== null
        ? zScore(amount, storeAvgAmount, storeStdAmount)
        : null,
    voidRateDeviationFromEmpBaseline:
      empVoidRate !== null && storeVoidRate !== null && storeVoidRate > 0
        ? (empVoidRate - storeVoidRate) / storeVoidRate
        : null,

    storeAvgAmount,
    storeVoidRate,
    storeRefundRate: storeBaseline ? Number(storeBaseline.refundRate ?? 0) : null,
    storeBaselineConfidence: storeBaseline?.confidence ?? null,

    hourlyAvgVolume: timeBaseline ? Number(timeBaseline.avgVolume ?? 0) : null,
    hourlyAvgAmount: timeBaseline ? Number(timeBaseline.avgAmount ?? 0) : null,

    featureVersion: '1.0.0',
  }
}

// ==================== ML INFERENCE ====================

async function callMlService(features: TransactionFeatures[]): Promise<number[]> {
  const mlUrl = process.env.ML_SERVICE_URL
  if (!mlUrl) return features.map(() => 0)

  try {
    const res = await fetch(`${mlUrl}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`ML service error: ${res.status}`)
    const data = (await res.json()) as { scores: number[] }
    return data.scores
  } catch (err) {
    // ML unavailable - graceful fallback
    console.warn('[analysis] ML service unavailable, using rules+baselines only:', err)
    return features.map(() => 0)
  }
}

// ==================== ANALYZE SINGLE TRANSACTION ====================

interface AnalysisResult {
  transactionId: string
  triggered: boolean
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  score: number
  evidenceItems: string[]
  triggeredRules: string[]
  mlScore: number
  mlUnavailable: boolean
  features: TransactionFeatures
}

export async function analyzeTransaction(
  orgId: string,
  tx: typeof transactions.$inferSelect
): Promise<AnalysisResult> {
  // 1. Generate features
  const features = await generateFeatures(orgId, tx)

  // 2. Fetch context for rules
  const empBaseline = tx.employeeId
    ? await getEmployeeBaseline(orgId, tx.employeeId)
    : null

  const storeBaseline = await getStoreBaseline(orgId, tx.storeId)

  const recentTxns = tx.employeeId
    ? await getRecentEmployeeTransactions(orgId, tx.employeeId, 24)
    : []

  const sequenceTxns = tx.registerId
    ? await getNearbyRegisterTransactions(orgId, tx.registerId, new Date(tx.timestamp), 30)
    : []

  // Map DB rows to Transaction type for risk engine
  const toTx = (row: typeof transactions.$inferSelect): Transaction => ({
    id: row.id,
    organizationId: row.organizationId,
    storeId: row.storeId,
    registerId: row.registerId ?? undefined,
    employeeId: row.employeeId ?? undefined,
    timestamp: new Date(row.timestamp),
    currency: row.currency,
    grossAmount: Number(row.grossAmount),
    discountAmount: Number(row.discountAmount),
    refundAmount: Number(row.refundAmount),
    netAmount: Number(row.netAmount),
    paymentMethod: row.paymentMethod ?? undefined,
    transactionStatus: row.transactionStatus,
    itemCount: row.itemCount ?? undefined,
    durationSeconds: row.durationSeconds ?? undefined,
    isVoid: row.isVoid,
    isRefund: row.isRefund,
    isNoSale: row.isNoSale,
    hasPriceOverride: row.hasPriceOverride,
    discountPercent: row.discountPercent ? Number(row.discountPercent) : undefined,
    source: row.source,
    isDemo: row.isDemo,
  })

  const ruleCtx: RuleContext = {
    transaction: toTx(tx),
    employeeBaseline: empBaseline
      ? {
          employeeId: empBaseline.employeeId,
          period: empBaseline.period,
          confidence: empBaseline.confidence,
          txCount: empBaseline.txCount,
          avgAmount: empBaseline.avgAmount ? Number(empBaseline.avgAmount) : undefined,
          medianAmount: empBaseline.medianAmount ? Number(empBaseline.medianAmount) : undefined,
          stdAmount: empBaseline.stdAmount ? Number(empBaseline.stdAmount) : undefined,
          txPerHour: empBaseline.txPerHour ? Number(empBaseline.txPerHour) : undefined,
          voidRate: empBaseline.voidRate ? Number(empBaseline.voidRate) : undefined,
          refundRate: empBaseline.refundRate ? Number(empBaseline.refundRate) : undefined,
          discountRate: empBaseline.discountRate ? Number(empBaseline.discountRate) : undefined,
          priceOverrideRate: empBaseline.priceOverrideRate ? Number(empBaseline.priceOverrideRate) : undefined,
          avgDiscountPct: empBaseline.avgDiscountPct ? Number(empBaseline.avgDiscountPct) : undefined,
        }
      : undefined,
    storeBaseline: storeBaseline
      ? {
          storeId: storeBaseline.storeId,
          period: storeBaseline.period,
          confidence: storeBaseline.confidence,
          txCount: storeBaseline.txCount,
          avgAmount: storeBaseline.avgAmount ? Number(storeBaseline.avgAmount) : undefined,
          medianAmount: storeBaseline.medianAmount ? Number(storeBaseline.medianAmount) : undefined,
          stdAmount: storeBaseline.stdAmount ? Number(storeBaseline.stdAmount) : undefined,
          voidRate: storeBaseline.voidRate ? Number(storeBaseline.voidRate) : undefined,
          refundRate: storeBaseline.refundRate ? Number(storeBaseline.refundRate) : undefined,
          discountRate: storeBaseline.discountRate ? Number(storeBaseline.discountRate) : undefined,
        }
      : undefined,
    recentTransactions: recentTxns.map(toTx),
    sequenceTransactions: sequenceTxns.map(toTx),
  }

  // 3. Evaluate rules
  const riskScore = evaluateRisk(ruleCtx)

  // 4. ML score (0 if unavailable)
  let mlScore = 0
  let mlUnavailable = false
  try {
    const mlScores = await callMlService([features])
    mlScore = mlScores[0] ?? 0
  } catch {
    mlUnavailable = true
  }

  // 5. Combined risk score (rules 60%, ML 20%, baseline 20%)
  const combinedScore = Math.min(1,
    riskScore.ruleScore * 0.6 +
    mlScore * 0.2 +
    riskScore.baselineScore * 0.2
  )

  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
  if (combinedScore >= 0.5) riskLevel = 'HIGH'
  else if (combinedScore >= 0.25) riskLevel = 'MEDIUM'
  else riskLevel = 'LOW'

  let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  if (combinedScore >= 0.75) severity = 'CRITICAL'
  else if (combinedScore >= 0.5) severity = 'HIGH'
  else if (combinedScore >= 0.25) severity = 'MEDIUM'
  else severity = 'LOW'

  return {
    transactionId: tx.id,
    triggered: riskScore.triggeredRules.length > 0,
    riskLevel,
    severity,
    score: combinedScore,
    evidenceItems: riskScore.evidenceItems,
    triggeredRules: riskScore.triggeredRules.map(r => r.ruleId),
    mlScore,
    mlUnavailable,
    features,
  }
}

// ==================== INCIDENT CORRELATION ====================

interface PendingIncident {
  transactionId: string
  employeeId: string | null
  registerId: string | null
  storeId: string
  timestamp: Date
  result: AnalysisResult
}

const CORRELATION_WINDOW_MINUTES = 30
const CORRELATION_FIELDS: Array<keyof PendingIncident> = ['employeeId', 'registerId']

function shouldCorrelate(a: PendingIncident, b: PendingIncident): boolean {
  const timeDiff = Math.abs(a.timestamp.getTime() - b.timestamp.getTime())
  if (timeDiff > CORRELATION_WINDOW_MINUTES * 60 * 1000) return false
  return a.employeeId === b.employeeId || a.registerId === b.registerId
}

function correlate(pending: PendingIncident[]): PendingIncident[][] {
  const groups: PendingIncident[][] = []
  const assigned = new Set<number>()

  for (let i = 0; i < pending.length; i++) {
    if (assigned.has(i)) continue
    const group = [pending[i]]
    assigned.add(i)

    for (let j = i + 1; j < pending.length; j++) {
      if (assigned.has(j)) continue
      if (shouldCorrelate(pending[i], pending[j])) {
        group.push(pending[j])
        assigned.add(j)
      }
    }
    groups.push(group)
  }
  return groups
}

// ==================== INCIDENT CREATION ====================

async function createIncidentFromGroup(
  orgId: string,
  group: PendingIncident[],
  db: ReturnType<typeof getDb>
): Promise<string> {
  // Use highest-severity result as the primary
  const primary = group.sort((a, b) => b.result.score - a.result.score)[0]

  // Gather all evidence across the group
  const allEvidence: string[] = []
  const allRules = new Set<string>()

  for (const item of group) {
    allEvidence.push(...item.result.evidenceItems)
    for (const r of item.result.triggeredRules) allRules.add(r)
  }

  // Deduplicate evidence
  const uniqueEvidence = [...new Set(allEvidence)]

  // Build incident type
  const incidentType = primary.result.triggeredRules[0] ?? 'anomaly'

  // Build human-readable title
  const typeLabels: Record<string, string> = {
    void_after_cash: 'Void After Cash Payment',
    no_sale_drawer: 'No-Sale Drawer Opening',
    repeated_voids: 'Repeated Void Pattern',
    large_refund: 'Large Refund',
    rapid_sale_refund: 'Rapid Sale-Refund Sequence',
    excessive_discount: 'Excessive Discount',
    price_override: 'Price Override',
    after_hours: 'After-Hours Activity',
    unusual_amount: 'Unusual Transaction Amount',
    cash_variance: 'Cash Variance',
    anomaly: 'Unusual Activity Detected',
  }

  const title = typeLabels[incidentType] ?? 'Unusual Transaction Pattern'

  // Build summary
  const txCount = group.length
  const summary =
    txCount > 1
      ? `${txCount} related transactions flagged for review. ${uniqueEvidence[0] ?? ''}`
      : uniqueEvidence[0] ?? 'Transaction flagged for review based on unusual patterns.'

  const incidentId = nanoid()

  // Determine next follow-up time based on risk level
  const followUpHours = primary.result.riskLevel === 'HIGH' ? 4 : primary.result.riskLevel === 'MEDIUM' ? 24 : 72
  const nextFollowUpAt = new Date(Date.now() + followUpHours * 60 * 60 * 1000)

  await db.insert(incidents).values({
    id: incidentId,
    organizationId: orgId,
    storeId: primary.storeId,
    registerId: primary.registerId,
    employeeId: primary.employeeId,
    severity: primary.result.severity,
    riskLevel: primary.result.riskLevel,
    status: 'OPEN',
    type: incidentType,
    title,
    summary,
    whyFlagged: uniqueEvidence as unknown as string[],
    ruleIds: [...allRules] as unknown as string[],
    mlScore: primary.result.mlScore > 0 ? primary.result.mlScore.toFixed(4) : null,
    featureVersion: '1.0.0',
    nextFollowUpAt,
    followUpCount: 0,
    escalationLevel: 0,
    isDemo: false,
  })

  // Link evidence
  for (let i = 0; i < uniqueEvidence.length; i++) {
    await db.insert(incidentEvidence).values({
      id: nanoid(),
      incidentId,
      type: 'rule',
      description: uniqueEvidence[i],
      severity: primary.result.severity,
      score: (primary.result.score - i * 0.05).toFixed(4),
    })
  }

  // Link transactions
  for (const item of group) {
    await db
      .insert(incidentTransactions)
      .values({ incidentId, transactionId: item.transactionId })
      .onConflictDoNothing()
  }

  return incidentId
}

// ==================== BATCH ANALYSIS ====================

export async function analyzeTransactionBatch(
  orgId: string,
  txIds: string[],
  opts: { isDemo?: boolean } = {}
): Promise<{ analyzed: number; incidentsCreated: number; errors: number }> {
  const db = getDb()
  let analyzed = 0
  let incidentsCreated = 0
  let errors = 0

  // Fetch transactions
  const txRows = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        inArray(transactions.id, txIds)
      )
    )
    .orderBy(transactions.timestamp)

  // Analyze each transaction
  const pending: PendingIncident[] = []

  for (const tx of txRows) {
    try {
      const result = await analyzeTransaction(orgId, tx)

      // Save feature snapshot
      await db
        .insert(featureSnapshots)
        .values({
          id: nanoid(),
          transactionId: tx.id,
          organizationId: orgId,
          features: result.features as unknown as Record<string, unknown>,
          featureVersion: '1.0.0',
          mlScore: result.mlScore > 0 ? result.mlScore.toFixed(5) : null,
        })
        .onConflictDoNothing()

      if (result.triggered) {
        pending.push({
          transactionId: tx.id,
          employeeId: tx.employeeId,
          registerId: tx.registerId,
          storeId: tx.storeId,
          timestamp: new Date(tx.timestamp),
          result,
        })
      }
      analyzed++
    } catch (err) {
      console.error(`[analysis] Error analyzing tx ${tx.id}:`, err)
      errors++
    }
  }

  // Correlate and create incidents
  if (pending.length > 0) {
    const groups = correlate(pending)
    for (const group of groups) {
      try {
        await createIncidentFromGroup(orgId, group, db)
        incidentsCreated++
      } catch (err) {
        console.error('[analysis] Error creating incident:', err)
        errors++
      }
    }
  }

  return { analyzed, incidentsCreated, errors }
}

// ==================== FULL ORG ANALYSIS (post-import) ====================

export async function analyzeImportedTransactions(
  orgId: string,
  importJobId: string
): Promise<{ analyzed: number; incidentsCreated: number }> {
  const db = getDb()

  // Create analysis job record
  const jobId = nanoid()
  await db.insert(analysisJobs).values({
    id: jobId,
    organizationId: orgId,
    importJobId,
    status: 'RUNNING',
    startedAt: new Date(),
  })

  try {
    // Get all transaction IDs from this import job
    const txRows = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.organizationId, orgId),
          eq(transactions.importJobId, importJobId),
          eq(transactions.isDemo, false)
        )
      )
      .orderBy(transactions.timestamp)

    const txIds = txRows.map(r => r.id)

    // Process in batches of 100 to avoid memory issues
    const BATCH_SIZE = 100
    let totalAnalyzed = 0
    let totalIncidents = 0

    for (let i = 0; i < txIds.length; i += BATCH_SIZE) {
      const batch = txIds.slice(i, i + BATCH_SIZE)
      const { analyzed, incidentsCreated } = await analyzeTransactionBatch(orgId, batch)
      totalAnalyzed += analyzed
      totalIncidents += incidentsCreated

      // Update progress
      await db
        .update(analysisJobs)
        .set({
          processedCount: totalAnalyzed,
          incidentsCreated: totalIncidents,
        })
        .where(eq(analysisJobs.id, jobId))
    }

    await db
      .update(analysisJobs)
      .set({
        status: 'COMPLETED',
        transactionCount: txIds.length,
        processedCount: totalAnalyzed,
        incidentsCreated: totalIncidents,
        completedAt: new Date(),
      })
      .where(eq(analysisJobs.id, jobId))

    return { analyzed: totalAnalyzed, incidentsCreated: totalIncidents }
  } catch (err) {
    await db
      .update(analysisJobs)
      .set({
        status: 'FAILED',
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      })
      .where(eq(analysisJobs.id, jobId))
    throw err
  }
}
