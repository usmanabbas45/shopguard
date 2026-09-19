/**
 * ShopGuard Baseline Engine
 *
 * Calculates statistical baselines for employees, stores, registers, and time periods.
 * Used by the risk engine to compare current behavior against historical norms.
 *
 * Supports rolling windows: 7d, 14d, 30d, 60d, 90d
 * Tracks baseline confidence: LOW / MEDIUM / HIGH
 * Never aggressively flags when confidence is LOW (< minSampleSize transactions)
 */

import { getDb } from '../db'
import {
  transactions, employees, stores, registers,
  employeeBaselines, storeBaselines, registerBaselines, timeBaselines,
  type employeeBaselines as EmployeeBaselineType,
} from '@shopguard/database'
import { eq, and, gte, lte, sql, count } from 'drizzle-orm'
import { nanoid } from 'nanoid'

export type Period = 'rolling_7d' | 'rolling_14d' | 'rolling_30d' | 'rolling_60d' | 'rolling_90d'

const PERIOD_DAYS: Record<Period, number> = {
  rolling_7d: 7,
  rolling_14d: 14,
  rolling_30d: 30,
  rolling_60d: 60,
  rolling_90d: 90,
}

function getConfidence(txCount: number, minSample: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (txCount < minSample) return 'LOW'
  if (txCount < minSample * 3) return 'MEDIUM'
  return 'HIGH'
}

function safe(n: number | null | undefined): number {
  if (n === null || n === undefined || isNaN(n) || !isFinite(n)) return 0
  return n
}

function rate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return numerator / denominator
}

// ==================== EMPLOYEE BASELINES ====================

export async function calculateEmployeeBaselines(
  orgId: string,
  employeeId: string,
  period: Period = 'rolling_30d',
  minSampleSize = 20
): Promise<void> {
  const db = getDb()
  const days = PERIOD_DAYS[period]
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  // Aggregate transaction stats for this employee
  const [stats] = await db
    .select({
      txCount: sql<number>`count(*)`,
      salesTotal: sql<number>`coalesce(sum(case when not is_void and not is_refund then net_amount::numeric else 0 end), 0)`,
      grossTotal: sql<number>`coalesce(sum(case when not is_void then gross_amount::numeric else 0 end), 0)`,
      avgAmount: sql<number>`coalesce(avg(case when not is_void and not is_refund then net_amount::numeric end), 0)`,
      // Use approximate median via percentile_cont
      medianAmount: sql<number>`coalesce(percentile_cont(0.5) within group (order by case when not is_void and not is_refund then net_amount::numeric end), 0)`,
      stdAmount: sql<number>`coalesce(stddev_pop(case when not is_void and not is_refund then net_amount::numeric end), 0)`,
      voidCount: sql<number>`count(*) filter (where is_void)`,
      refundCount: sql<number>`count(*) filter (where is_refund)`,
      noSaleCount: sql<number>`count(*) filter (where is_no_sale)`,
      discountCount: sql<number>`count(*) filter (where discount_amount::numeric > 0)`,
      priceOverrideCount: sql<number>`count(*) filter (where has_price_override)`,
      cashCount: sql<number>`count(*) filter (where payment_method = 'cash')`,
      afterHoursCount: sql<number>`count(*) filter (where extract(hour from timestamp) < 8 or extract(hour from timestamp) >= 22)`,
      avgDiscountPct: sql<number>`coalesce(avg(case when discount_percent is not null then discount_percent::numeric end), 0)`,
      avgItemCount: sql<number>`coalesce(avg(item_count), 0)`,
      // Transactions per hour (unique hours active)
      uniqueHours: sql<number>`count(distinct date_trunc('hour', timestamp))`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.employeeId, employeeId),
        gte(transactions.timestamp, since),
        eq(transactions.isDemo, false)
      )
    )

  if (!stats) return

  const txCount = Number(stats.txCount)
  const confidence = getConfidence(txCount, minSampleSize)
  const voidRate = rate(Number(stats.voidCount), txCount)
  const refundRate = rate(Number(stats.refundCount), txCount)
  const discountRate = rate(Number(stats.discountCount), txCount)
  const priceOverrideRate = rate(Number(stats.priceOverrideCount), txCount)
  const cashRate = rate(Number(stats.cashCount), txCount)
  const txPerHour = Number(stats.uniqueHours) > 0 ? txCount / Number(stats.uniqueHours) : 0

  const values = {
    id: nanoid(),
    organizationId: orgId,
    employeeId,
    period,
    confidence: confidence as 'LOW' | 'MEDIUM' | 'HIGH',
    txCount,
    avgAmount: safe(Number(stats.avgAmount)).toFixed(2),
    medianAmount: safe(Number(stats.medianAmount)).toFixed(2),
    stdAmount: safe(Number(stats.stdAmount)).toFixed(2),
    txPerHour: txPerHour.toFixed(4),
    voidRate: voidRate.toFixed(5),
    refundRate: refundRate.toFixed(5),
    discountRate: discountRate.toFixed(5),
    priceOverrideRate: priceOverrideRate.toFixed(5),
    avgDiscountPct: safe(Number(stats.avgDiscountPct)).toFixed(3),
    computedAt: new Date(),
  }

  await db
    .insert(employeeBaselines)
    .values(values)
    .onConflictDoUpdate({
      target: [employeeBaselines.employeeId, employeeBaselines.period],
      set: {
        confidence: values.confidence,
        txCount: values.txCount,
        avgAmount: values.avgAmount,
        medianAmount: values.medianAmount,
        stdAmount: values.stdAmount,
        txPerHour: values.txPerHour,
        voidRate: values.voidRate,
        refundRate: values.refundRate,
        discountRate: values.discountRate,
        priceOverrideRate: values.priceOverrideRate,
        avgDiscountPct: values.avgDiscountPct,
        computedAt: new Date(),
      },
    })
}

// ==================== STORE BASELINES ====================

export async function calculateStoreBaselines(
  orgId: string,
  storeId: string,
  period: Period = 'rolling_30d',
  minSampleSize = 100
): Promise<void> {
  const db = getDb()
  const days = PERIOD_DAYS[period]
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const [stats] = await db
    .select({
      txCount: sql<number>`count(*)`,
      avgAmount: sql<number>`coalesce(avg(case when not is_void and not is_refund then net_amount::numeric end), 0)`,
      medianAmount: sql<number>`coalesce(percentile_cont(0.5) within group (order by case when not is_void and not is_refund then net_amount::numeric end), 0)`,
      stdAmount: sql<number>`coalesce(stddev_pop(case when not is_void and not is_refund then net_amount::numeric end), 0)`,
      voidCount: sql<number>`count(*) filter (where is_void)`,
      refundCount: sql<number>`count(*) filter (where is_refund)`,
      discountCount: sql<number>`count(*) filter (where discount_amount::numeric > 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.storeId, storeId),
        gte(transactions.timestamp, since),
        eq(transactions.isDemo, false)
      )
    )

  if (!stats) return

  const txCount = Number(stats.txCount)
  const confidence = getConfidence(txCount, minSampleSize)

  // Hourly volume distribution
  const hourlyRows = await db
    .select({
      hour: sql<number>`extract(hour from timestamp)::int`,
      avgCount: sql<number>`count(*)::float / greatest(count(distinct date_trunc('day', timestamp)), 1)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.storeId, storeId),
        gte(transactions.timestamp, since),
        eq(transactions.isDemo, false)
      )
    )
    .groupBy(sql`extract(hour from timestamp)`)

  const hourlyVolume: Record<string, number> = {}
  for (const row of hourlyRows) {
    hourlyVolume[String(row.hour)] = Number(row.avgCount)
  }

  // Day-of-week volume
  const dowRows = await db
    .select({
      dow: sql<number>`extract(dow from timestamp)::int`,
      avgCount: sql<number>`count(*)::float / greatest(count(distinct date_trunc('day', timestamp)), 1)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.storeId, storeId),
        gte(transactions.timestamp, since),
        eq(transactions.isDemo, false)
      )
    )
    .groupBy(sql`extract(dow from timestamp)`)

  const dowVolume: Record<string, number> = {}
  for (const row of dowRows) {
    dowVolume[String(row.dow)] = Number(row.avgCount)
  }

  const values = {
    id: nanoid(),
    organizationId: orgId,
    storeId,
    period,
    confidence: confidence as 'LOW' | 'MEDIUM' | 'HIGH',
    txCount,
    avgAmount: safe(Number(stats.avgAmount)).toFixed(2),
    medianAmount: safe(Number(stats.medianAmount)).toFixed(2),
    stdAmount: safe(Number(stats.stdAmount)).toFixed(2),
    voidRate: rate(Number(stats.voidCount), txCount).toFixed(5),
    refundRate: rate(Number(stats.refundCount), txCount).toFixed(5),
    discountRate: rate(Number(stats.discountCount), txCount).toFixed(5),
    hourlyVolume: hourlyVolume as Record<string, number>,
    dowVolume: dowVolume as Record<string, number>,
    computedAt: new Date(),
  }

  await db
    .insert(storeBaselines)
    .values(values)
    .onConflictDoUpdate({
      target: [storeBaselines.storeId, storeBaselines.period],
      set: {
        confidence: values.confidence,
        txCount: values.txCount,
        avgAmount: values.avgAmount,
        medianAmount: values.medianAmount,
        stdAmount: values.stdAmount,
        voidRate: values.voidRate,
        refundRate: values.refundRate,
        discountRate: values.discountRate,
        hourlyVolume: values.hourlyVolume,
        dowVolume: values.dowVolume,
        computedAt: new Date(),
      },
    })
}

// ==================== REGISTER BASELINES ====================

export async function calculateRegisterBaselines(
  orgId: string,
  registerId: string,
  period: Period = 'rolling_30d',
  minSampleSize = 50
): Promise<void> {
  const db = getDb()
  const days = PERIOD_DAYS[period]
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const [stats] = await db
    .select({
      txCount: sql<number>`count(*)`,
      noSaleCount: sql<number>`count(*) filter (where is_no_sale)`,
      voidCount: sql<number>`count(*) filter (where is_void)`,
      refundCount: sql<number>`count(*) filter (where is_refund)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.registerId, registerId),
        gte(transactions.timestamp, since),
        eq(transactions.isDemo, false)
      )
    )

  if (!stats || Number(stats.txCount) === 0) return

  const txCount = Number(stats.txCount)
  const confidence = getConfidence(txCount, minSampleSize)

  const values = {
    id: nanoid(),
    organizationId: orgId,
    registerId,
    period,
    confidence: confidence as 'LOW' | 'MEDIUM' | 'HIGH',
    txCount,
    noSaleRate: rate(Number(stats.noSaleCount), txCount).toFixed(5),
    voidRate: rate(Number(stats.voidCount), txCount).toFixed(5),
    refundRate: rate(Number(stats.refundCount), txCount).toFixed(5),
    computedAt: new Date(),
  }

  await db
    .insert(registerBaselines)
    .values(values)
    .onConflictDoUpdate({
      target: [registerBaselines.registerId, registerBaselines.period],
      set: {
        confidence: values.confidence,
        txCount: values.txCount,
        noSaleRate: values.noSaleRate,
        voidRate: values.voidRate,
        refundRate: values.refundRate,
        computedAt: new Date(),
      },
    })
}

// ==================== TIME BASELINES (HOUR + DOW) ====================

export async function calculateTimeBaselines(
  orgId: string,
  storeId: string,
  minWeeks = 2
): Promise<void> {
  const db = getDb()

  // Calculate per hour-of-day baseline (across all history)
  const hourRows = await db
    .select({
      hour: sql<number>`extract(hour from timestamp)::int`,
      dayOfWeek: sql<number>`extract(dow from timestamp)::int`,
      avgVolume: sql<number>`count(*)::float / greatest(count(distinct date_trunc('week', timestamp)), 1)`,
      avgAmount: sql<number>`coalesce(avg(case when not is_void and not is_refund then net_amount::numeric end), 0)`,
      avgVoidRate: sql<number>`count(*) filter (where is_void)::float / greatest(count(*), 1)`,
      weekCount: sql<number>`count(distinct date_trunc('week', timestamp))`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.storeId, storeId),
        eq(transactions.isDemo, false)
      )
    )
    .groupBy(sql`extract(hour from timestamp), extract(dow from timestamp)`)

  for (const row of hourRows) {
    const weekCount = Number(row.weekCount)
    if (weekCount < minWeeks) continue

    await db
      .insert(timeBaselines)
      .values({
        id: nanoid(),
        organizationId: orgId,
        storeId,
        hour: Number(row.hour),
        dayOfWeek: Number(row.dayOfWeek),
        avgVolume: Number(row.avgVolume).toFixed(2),
        avgAmount: Number(row.avgAmount).toFixed(2),
        avgVoidRate: Number(row.avgVoidRate).toFixed(5),
        sampleWeeks: weekCount,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [timeBaselines.storeId, timeBaselines.hour, timeBaselines.dayOfWeek],
        set: {
          avgVolume: Number(row.avgVolume).toFixed(2),
          avgAmount: Number(row.avgAmount).toFixed(2),
          avgVoidRate: Number(row.avgVoidRate).toFixed(5),
          sampleWeeks: weekCount,
          computedAt: new Date(),
        },
      })
  }
}

// ==================== FULL ORG BASELINE RECALCULATION ====================

export async function recalculateAllBaselines(
  orgId: string,
  periods: Period[] = ['rolling_7d', 'rolling_30d', 'rolling_60d']
): Promise<{ employees: number; stores: number; registers: number }> {
  const db = getDb()

  // Get all active employees for this org
  const orgEmployees = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true)))

  // Get all active stores
  const orgStores = await db
    .select({ id: stores.id })
    .from(stores)
    .where(and(eq(stores.organizationId, orgId), eq(stores.isActive, true)))

  // Get all active registers
  const orgRegisters = await db
    .select({ id: registers.id })
    .from(registers)
    .where(eq(registers.organizationId, orgId))

  let empCount = 0
  for (const emp of orgEmployees) {
    for (const period of periods) {
      await calculateEmployeeBaselines(orgId, emp.id, period)
    }
    empCount++
  }

  let storeCount = 0
  for (const store of orgStores) {
    for (const period of periods) {
      await calculateStoreBaselines(orgId, store.id, period)
    }
    await calculateTimeBaselines(orgId, store.id)
    storeCount++
  }

  let regCount = 0
  for (const reg of orgRegisters) {
    for (const period of periods) {
      await calculateRegisterBaselines(orgId, reg.id, period)
    }
    regCount++
  }

  return { employees: empCount, stores: storeCount, registers: regCount }
}

// ==================== FETCH BASELINES FOR RISK ENGINE ====================

export async function getEmployeeBaseline(
  orgId: string,
  employeeId: string,
  period: Period = 'rolling_30d'
) {
  const db = getDb()
  const [result] = await db
    .select()
    .from(employeeBaselines)
    .where(
      and(
        eq(employeeBaselines.organizationId, orgId),
        eq(employeeBaselines.employeeId, employeeId),
        eq(employeeBaselines.period, period)
      )
    )
    .limit(1)
  return result ?? null
}

export async function getStoreBaseline(
  orgId: string,
  storeId: string,
  period: Period = 'rolling_30d'
) {
  const db = getDb()
  const [result] = await db
    .select()
    .from(storeBaselines)
    .where(
      and(
        eq(storeBaselines.organizationId, orgId),
        eq(storeBaselines.storeId, storeId),
        eq(storeBaselines.period, period)
      )
    )
    .limit(1)
  return result ?? null
}

export async function getTimeBaseline(
  orgId: string,
  storeId: string,
  hour: number,
  dayOfWeek: number
) {
  const db = getDb()
  const [result] = await db
    .select()
    .from(timeBaselines)
    .where(
      and(
        eq(timeBaselines.organizationId, orgId),
        eq(timeBaselines.storeId, storeId),
        eq(timeBaselines.hour, hour),
        eq(timeBaselines.dayOfWeek, dayOfWeek)
      )
    )
    .limit(1)
  return result ?? null
}

// Get recent transactions for an employee (for repeated-void check)
export async function getRecentEmployeeTransactions(
  orgId: string,
  employeeId: string,
  hours = 24
) {
  const db = getDb()
  const since = new Date(Date.now() - hours * 60 * 60 * 1000)
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.employeeId, employeeId),
        gte(transactions.timestamp, since)
      )
    )
    .orderBy(transactions.timestamp)
}

// Get nearby register transactions (for sequence detection)
export async function getNearbyRegisterTransactions(
  orgId: string,
  registerId: string,
  timestamp: Date,
  windowMinutes = 30
) {
  const db = getDb()
  const windowStart = new Date(timestamp.getTime() - windowMinutes * 60 * 1000)
  const windowEnd = new Date(timestamp.getTime() + 5 * 60 * 1000) // +5min after
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.registerId, registerId),
        gte(transactions.timestamp, windowStart),
        lte(transactions.timestamp, windowEnd)
      )
    )
    .orderBy(transactions.timestamp)
}
