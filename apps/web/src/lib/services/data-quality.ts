/**
 * ShopGuard Data Quality Engine
 * Automatically detects data issues in imported transactions.
 */

import { getDb } from '../db'
import { transactions, dataQualityIssues, importJobs } from '@shopguard/database'
import { eq, and, sql, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'

interface QualityIssue {
  rowNumber?: number
  field?: string
  issueType: string
  description: string
  rawValue?: string
}

export async function runDataQualityChecks(
  orgId: string,
  importJobId?: string
): Promise<number> {
  const db = getDb()
  const issues: (QualityIssue & { importJobId: string })[] = []

  const jobId = importJobId ?? 'system-check'

  // 1. Duplicate external transaction IDs
  const dupes = await db
    .select({
      externalId: transactions.externalTransactionId,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(and(
      eq(transactions.organizationId, orgId),
      eq(transactions.isDemo, false),
      sql`external_transaction_id is not null`
    ))
    .groupBy(transactions.externalTransactionId)
    .having(sql`count(*) > 1`)

  for (const d of dupes) {
    issues.push({
      importJobId: jobId,
      issueType: 'duplicate_transaction',
      description: `External ID "${d.externalId}" appears ${d.count} times`,
      rawValue: d.externalId ?? undefined,
    })
  }

  // 2. Future timestamps
  const futureTxns = await db
    .select({ id: transactions.id, timestamp: transactions.timestamp })
    .from(transactions)
    .where(and(
      eq(transactions.organizationId, orgId),
      eq(transactions.isDemo, false),
      sql`timestamp > now() + interval '5 minutes'`
    ))
    .limit(50)

  for (const tx of futureTxns) {
    issues.push({
      importJobId: jobId,
      field: 'timestamp',
      issueType: 'future_timestamp',
      description: `Transaction ${tx.id} has future timestamp`,
      rawValue: tx.timestamp.toISOString(),
    })
  }

  // 3. Negative amounts (not refunds)
  const negAmounts = await db
    .select({ id: transactions.id, netAmount: transactions.netAmount })
    .from(transactions)
    .where(and(
      eq(transactions.organizationId, orgId),
      eq(transactions.isDemo, false),
      eq(transactions.isRefund, false),
      eq(transactions.isVoid, false),
      sql`net_amount::numeric < 0`
    ))
    .limit(50)

  for (const tx of negAmounts) {
    issues.push({
      importJobId: jobId,
      field: 'net_amount',
      issueType: 'negative_amount',
      description: `Non-refund transaction ${tx.id} has negative net amount`,
      rawValue: String(tx.netAmount),
    })
  }

  // 4. Missing employee on transactions
  const noEmployee = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(and(
      eq(transactions.organizationId, orgId),
      eq(transactions.isDemo, false),
      isNull(transactions.employeeId)
    ))

  const noEmpCount = Number(noEmployee[0]?.count ?? 0)
  if (noEmpCount > 0) {
    issues.push({
      importJobId: jobId,
      field: 'employee_id',
      issueType: 'missing_employee',
      description: `${noEmpCount} transactions have no employee assigned`,
    })
  }

  // 5. Missing register on transactions
  const noRegister = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(and(
      eq(transactions.organizationId, orgId),
      eq(transactions.isDemo, false),
      isNull(transactions.registerId)
    ))

  const noRegCount = Number(noRegister[0]?.count ?? 0)
  if (noRegCount > 0) {
    issues.push({
      importJobId: jobId,
      field: 'register_id',
      issueType: 'missing_register',
      description: `${noRegCount} transactions have no register assigned`,
    })
  }

  // 6. Invalid refund amounts > gross
  const badRefunds = await db
    .select({ id: transactions.id, refundAmount: transactions.refundAmount, grossAmount: transactions.grossAmount })
    .from(transactions)
    .where(and(
      eq(transactions.organizationId, orgId),
      eq(transactions.isDemo, false),
      sql`refund_amount::numeric > gross_amount::numeric`
    ))
    .limit(20)

  for (const tx of badRefunds) {
    issues.push({
      importJobId: jobId,
      field: 'refund_amount',
      issueType: 'invalid_refund',
      description: `Transaction ${tx.id} has refund (${tx.refundAmount}) > gross (${tx.grossAmount})`,
    })
  }

  // Persist to DB
  if (issues.length > 0) {
    // Use importJobId if we have a real one, otherwise skip DB write for system checks
    if (importJobId) {
      const rows = issues.slice(0, 200).map(issue => ({
        id: nanoid(),
        importJobId,
        rowNumber: issue.rowNumber ?? null,
        field: issue.field ?? null,
        issueType: issue.issueType,
        description: issue.description,
        rawValue: issue.rawValue ?? null,
      }))
      await db.insert(dataQualityIssues).values(rows)
    }
  }

  console.log(`[quality] Found ${issues.length} data quality issues for org ${orgId}`)
  return issues.length
}
