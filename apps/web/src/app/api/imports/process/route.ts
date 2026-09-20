import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { getSession } from '@/lib/auth'
import { parseTimestamp, parseAmount, parseBoolean, parsePaymentMethod } from '@/lib/csv-import'
import { parse } from 'csv-parse/sync'
import { enqueueAnalysis, enqueueBaseline, enqueueQuality, getRedis, QUEUE_NAMES, runJobInline } from '@/lib/queue/index'

type CSVRecord = Record<string, string>

const processSchema = z.object({
  filename: z.string(),
  csvContent: z.string().max(50 * 1024 * 1024),
  columnMappings: z.record(z.string()),
  storeId: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const parsed = processSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })

    const { filename, csvContent, columnMappings, storeId } = parsed.data
    const db = (await import('@/lib/db')).getDb()
    const { transactions, employees, stores, registers, importJobs } = await import('@shopguard/database')
    const { eq, and } = await import('drizzle-orm')

    const jobId = nanoid()
    await db.insert(importJobs).values({
      id: jobId,
      organizationId: session.organizationId,
      storeId: storeId ?? null,
      filename,
      originalName: filename,
      fileSize: csvContent.length,
      status: 'PROCESSING',
      startedAt: new Date(),
    })

    const MAX_ROWS = 100_000
    const records = parse(csvContent, {
      columns: true, skip_empty_lines: true, trim: true, relax_column_count: true,
    }) as CSVRecord[]

    if (records.length > MAX_ROWS) {
      await db.update(importJobs).set({
        status: 'FAILED',
        error: `File has ${records.length.toLocaleString()} rows, max is ${MAX_ROWS.toLocaleString()}`,
        completedAt: new Date(),
      }).where(eq(importJobs.id, jobId))
      return NextResponse.json({
        error: `File too large: ${records.length.toLocaleString()} rows. Max ${MAX_ROWS.toLocaleString()} per import.`,
      }, { status: 400 })
    }

    // Sanitize cell values to prevent CSV formula injection
    const sanitize = (v: string): string => {
      if (!v) return v
      if (['=', '+', '-', '@', '\t', '\r'].some(c => v.startsWith(c))) return `'${v}`
      return v
    }

    const get = (row: CSVRecord, field: string): string => sanitize(String(row[columnMappings[field] ?? ''] ?? '').trim())

    let imported = 0, skipped = 0, errorCount = 0
    const errors: string[] = []
    const empCache = new Map<string, string>()
    const regCache = new Map<string, string>()
    const orgId = session.organizationId
    const importedTxIds: string[] = []

    for (let i = 0; i < records.length; i++) {
      try {
        const row = records[i]
        const timestampStr = get(row, 'timestamp')
        const grossAmountStr = get(row, 'grossAmount')
        if (!timestampStr || !grossAmountStr) { skipped++; continue }

        const timestamp = parseTimestamp(timestampStr)
        if (!timestamp) { errors.push(`Row ${i + 2}: invalid timestamp "${timestampStr}"`); errorCount++; continue }
        if (timestamp > new Date(Date.now() + 5 * 60 * 1000)) { errors.push(`Row ${i + 2}: future timestamp rejected`); errorCount++; continue }

        const grossAmount = parseAmount(grossAmountStr)
        if (grossAmount === null || grossAmount < 0) { errors.push(`Row ${i + 2}: invalid amount`); errorCount++; continue }

        // Employee
        let employeeId: string | null = null
        const empName = get(row, 'employeeId')
        if (empName) {
          if (empCache.has(empName)) { employeeId = empCache.get(empName)! }
          else {
            const [existing] = await db.select({ id: employees.id }).from(employees)
              .where(and(eq(employees.organizationId, orgId), eq(employees.name, empName))).limit(1)
            if (existing) { employeeId = existing.id }
            else { const eid = nanoid(); await db.insert(employees).values({ id: eid, organizationId: orgId, name: empName, isActive: true }); employeeId = eid }
            empCache.set(empName, employeeId)
          }
        }

        // Store
        let resolvedStoreId = storeId ?? null
        const storeCode = get(row, 'storeId')
        if (storeCode && !resolvedStoreId) {
          const [s] = await db.select({ id: stores.id }).from(stores)
            .where(and(eq(stores.organizationId, orgId), eq(stores.code, storeCode))).limit(1)
          if (s) { resolvedStoreId = s.id }
          else { const sid = nanoid(); await db.insert(stores).values({ id: sid, organizationId: orgId, name: storeCode, code: storeCode, isActive: true }); resolvedStoreId = sid }
        }
        if (!resolvedStoreId) { skipped++; continue }

        // Register
        let registerId: string | null = null
        const regCode = get(row, 'registerId')
        if (regCode) {
          const ck = `${resolvedStoreId}:${regCode}`
          if (regCache.has(ck)) { registerId = regCache.get(ck)! }
          else {
            const [r] = await db.select({ id: registers.id }).from(registers)
              .where(and(eq(registers.storeId, resolvedStoreId), eq(registers.code, regCode))).limit(1)
            if (r) { registerId = r.id }
            else { const rid = nanoid(); await db.insert(registers).values({ id: rid, organizationId: orgId, storeId: resolvedStoreId, name: regCode, code: regCode, isActive: true }); registerId = rid }
            regCache.set(ck, registerId)
          }
        }

        const discountAmount = parseAmount(get(row, 'discountAmount')) ?? 0
        const refundAmount = parseAmount(get(row, 'refundAmount')) ?? 0
        const discountPercent = parseAmount(get(row, 'discountPercent'))
        const netAmountRaw = parseAmount(get(row, 'netAmount'))
        const netAmount = netAmountRaw ?? (grossAmount - discountAmount)
        const isVoid = parseBoolean(get(row, 'isVoid'))
        const isRefund = parseBoolean(get(row, 'isRefund')) || refundAmount > 0
        const isNoSale = parseBoolean(get(row, 'isNoSale'))
        const paymentMethod = parsePaymentMethod(get(row, 'paymentMethod'))
        const externalId = get(row, 'externalTransactionId') || null

        // Duplicate check
        if (externalId) {
          const [dup] = await db.select({ id: transactions.id }).from(transactions)
            .where(and(eq(transactions.organizationId, orgId), eq(transactions.externalTransactionId, externalId), eq(transactions.source, 'csv'))).limit(1)
          if (dup) { skipped++; continue }
        }

        const txId = nanoid()
        await db.insert(transactions).values({
          id: txId, organizationId: orgId, storeId: resolvedStoreId, registerId, employeeId,
          externalTransactionId: externalId, timestamp, currency: get(row, 'currency') || 'USD',
          grossAmount: grossAmount.toFixed(2), discountAmount: discountAmount.toFixed(2),
          refundAmount: refundAmount.toFixed(2), netAmount: netAmount.toFixed(2),
          paymentMethod, transactionStatus: isVoid ? 'VOIDED' : isRefund ? 'REFUNDED' : 'COMPLETED',
          isVoid, isRefund, isNoSale, hasPriceOverride: false,
          discountPercent: discountPercent ? discountPercent.toFixed(2) : null,
          source: 'csv', importJobId: jobId, isDemo: false,
        })
        importedTxIds.push(txId)
        imported++
      } catch (rowErr) {
        errorCount++
        if (errors.length < 50) errors.push(`Row ${i + 2}: ${rowErr instanceof Error ? rowErr.message : 'error'}`)
      }
    }

    await db.update(importJobs).set({
      status: 'COMPLETED', rowCount: records.length, importedCount: imported,
      skippedCount: skipped, errorCount, qualityReport: { errors: errors.slice(0, 50) },
      completedAt: new Date(),
    }).where(eq(importJobs.id, jobId))

    // Queue baseline + analysis + quality using BullMQ (or inline fallback)
    const useQueue = !!getRedis()
    const baselineKey = `baseline:${orgId}:import:${jobId}`
    const analysisKey = `analysis:import:${jobId}`
    const qualityKey = `quality:import:${jobId}`

    if (useQueue) {
      await enqueueBaseline({ organizationId: orgId, scope: 'all', idempotencyKey: baselineKey })
      await enqueueAnalysis({ organizationId: orgId, transactionIds: [], importJobId: jobId, idempotencyKey: analysisKey })
      await enqueueQuality({ organizationId: orgId, importJobId: jobId, idempotencyKey: qualityKey })
    } else {
      // Inline fallback for dev without Redis
      Promise.resolve().then(async () => {
        try {
          const { recalculateAllBaselines } = await import('@/lib/services/baseline-engine')
          await recalculateAllBaselines(orgId)
          const { analyzeImportedTransactions } = await import('@/lib/services/analysis-pipeline')
          await analyzeImportedTransactions(orgId, jobId)
          const { runDataQualityChecks } = await import('@/lib/services/data-quality')
          await runDataQualityChecks(orgId, jobId)
        } catch (err) { console.error('[import] Background processing error:', err) }
      })
    }

    return NextResponse.json({
      success: true, jobId, imported, skipped, errorCount,
      totalRows: records.length, errors: errors.slice(0, 20),
      analysisStatus: useQueue ? 'queued' : 'running_inline',
      message: useQueue
        ? `${imported} transactions imported. Analysis queued — check Dashboard in a moment.`
        : `${imported} transactions imported. Analysis running in background.`,
    })
  } catch (err) {
    console.error('[import/process]', err)
    return NextResponse.json({ error: 'Import failed' }, { status: 500 })
  }
}
