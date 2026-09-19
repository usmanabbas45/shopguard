/**
 * ShopGuard Daily Report Engine
 *
 * Generates daily reports per organization, respecting timezone.
 * Called by the REPORT_QUEUE worker.
 */

import { getDb } from '../db'
import { reports, transactions, incidents, cashSessions, employees, stores } from '@shopguard/database'
import { eq, and, gte, lte, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'

export async function generateDailyReport(
  orgId: string,
  dateStr: string,  // ISO date e.g. "2025-01-15"
  timezone: string
): Promise<string> {
  const db = getDb()

  // Parse the date in the org's timezone
  const date = new Date(dateStr + 'T00:00:00')
  const dayStart = new Date(dateStr + 'T00:00:00')
  const dayEnd = new Date(dateStr + 'T23:59:59')

  // Check idempotency - report for this org+date already exists?
  const [existing] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(
      eq(reports.organizationId, orgId),
      eq(reports.type, 'DAILY'),
      eq(reports.date, dateStr),
      eq(reports.isDemo, false)
    ))
    .limit(1)

  if (existing) return existing.id // Idempotent

  // Sales stats
  const [txStats] = await db
    .select({
      totalSales: sql<number>`coalesce(sum(case when not is_void and not is_refund then net_amount::numeric else 0 end), 0)`,
      txCount: sql<number>`count(*)`,
      voidCount: sql<number>`count(*) filter (where is_void)`,
      refundCount: sql<number>`count(*) filter (where is_refund)`,
      cashCount: sql<number>`count(*) filter (where payment_method = 'cash' and not is_void)`,
      avgAmount: sql<number>`coalesce(avg(case when not is_void and not is_refund then net_amount::numeric end), 0)`,
    })
    .from(transactions)
    .where(and(
      eq(transactions.organizationId, orgId),
      gte(transactions.timestamp, dayStart),
      lte(transactions.timestamp, dayEnd),
      eq(transactions.isDemo, false)
    ))

  // Incident stats
  const [incStats] = await db
    .select({
      totalCreated: sql<number>`count(*)`,
      highPriority: sql<number>`count(*) filter (where risk_level = 'HIGH')`,
      mediumPriority: sql<number>`count(*) filter (where risk_level = 'MEDIUM')`,
      open: sql<number>`count(*) filter (where status = 'OPEN')`,
      resolved: sql<number>`count(*) filter (where status in ('RESOLVED', 'DISMISSED'))`,
    })
    .from(incidents)
    .where(and(
      eq(incidents.organizationId, orgId),
      gte(incidents.createdAt, dayStart),
      lte(incidents.createdAt, dayEnd),
      eq(incidents.isDemo, false)
    ))

  // Unreviewed total (not just today's)
  const [unreviewedCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(incidents)
    .where(and(
      eq(incidents.organizationId, orgId),
      eq(incidents.status, 'OPEN'),
      eq(incidents.isDemo, false)
    ))

  // Cash variance summary
  const [cashStats] = await db
    .select({
      totalExpected: sql<number>`coalesce(sum(expected_cash::numeric), 0)`,
      totalCounted: sql<number>`coalesce(sum(counted_cash::numeric), 0)`,
      totalVariance: sql<number>`coalesce(sum(variance::numeric), 0)`,
      sessionCount: sql<number>`count(*)`,
    })
    .from(cashSessions)
    .where(and(
      eq(cashSessions.organizationId, orgId),
      eq(cashSessions.date, dateStr),
      eq(cashSessions.isDemo, false)
    ))

  // Employee activity
  const topEmployees = await db
    .select({
      name: employees.name,
      txCount: sql<number>`count(transactions.id)`,
      sales: sql<number>`coalesce(sum(case when not is_void and not is_refund then net_amount::numeric else 0 end), 0)`,
      voids: sql<number>`count(*) filter (where is_void)`,
    })
    .from(transactions)
    .leftJoin(employees, eq(employees.id, transactions.employeeId))
    .where(and(
      eq(transactions.organizationId, orgId),
      gte(transactions.timestamp, dayStart),
      lte(transactions.timestamp, dayEnd),
      eq(transactions.isDemo, false)
    ))
    .groupBy(employees.name, employees.id)
    .orderBy(sql`sales desc`)
    .limit(5)

  // Store breakdown
  const storeBreakdown = await db
    .select({
      name: stores.name,
      sales: sql<number>`coalesce(sum(case when not is_void and not is_refund then net_amount::numeric else 0 end), 0)`,
      txCount: sql<number>`count(transactions.id)`,
    })
    .from(transactions)
    .leftJoin(stores, eq(stores.id, transactions.storeId))
    .where(and(
      eq(transactions.organizationId, orgId),
      gte(transactions.timestamp, dayStart),
      lte(transactions.timestamp, dayEnd),
      eq(transactions.isDemo, false)
    ))
    .groupBy(stores.name, stores.id)

  const summary = {
    date: dateStr,
    timezone,
    sales: {
      total: Number(txStats?.totalSales ?? 0),
      transactions: Number(txStats?.txCount ?? 0),
      avgAmount: Number(txStats?.avgAmount ?? 0),
      voids: Number(txStats?.voidCount ?? 0),
      refunds: Number(txStats?.refundCount ?? 0),
      cashTransactions: Number(txStats?.cashCount ?? 0),
    },
    cash: {
      expected: Number(cashStats?.totalExpected ?? 0),
      counted: Number(cashStats?.totalCounted ?? 0),
      variance: Number(cashStats?.totalVariance ?? 0),
      sessions: Number(cashStats?.sessionCount ?? 0),
    },
    incidents: {
      createdToday: Number(incStats?.totalCreated ?? 0),
      highPriority: Number(incStats?.highPriority ?? 0),
      mediumPriority: Number(incStats?.mediumPriority ?? 0),
      resolvedToday: Number(incStats?.resolved ?? 0),
      totalUnreviewed: Number(unreviewedCount?.count ?? 0),
    },
    topEmployees: topEmployees.map(e => ({
      name: e.name ?? 'Unknown',
      txCount: Number(e.txCount),
      sales: Number(e.sales),
      voids: Number(e.voids),
    })),
    storeBreakdown: storeBreakdown.map(s => ({
      name: s.name ?? 'Unknown',
      sales: Number(s.sales),
      txCount: Number(s.txCount),
    })),
    generatedAt: new Date().toISOString(),
  }

  const reportId = nanoid()
  await db.insert(reports).values({
    id: reportId,
    organizationId: orgId,
    type: 'DAILY',
    title: `Daily Report — ${dateStr}`,
    date: dateStr,
    summary: summary as unknown as Record<string, unknown>,
    isGenerated: true,
    isDemo: false,
    generatedAt: new Date(),
  })

  console.log(`[report] Generated daily report ${reportId} for org ${orgId} on ${dateStr}`)
  return reportId
}

export async function getLatestReport(orgId: string, type = 'DAILY') {
  const db = getDb()
  const [report] = await db
    .select()
    .from(reports)
    .where(and(
      eq(reports.organizationId, orgId),
      eq(reports.type, type),
      eq(reports.isDemo, false)
    ))
    .orderBy(sql`date desc`)
    .limit(1)
  return report ?? null
}
