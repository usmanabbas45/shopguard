/**
 * ShopGuard Performance Tests
 *
 * Tests system performance at scale using synthetic data.
 * Does NOT require a live database — tests the algorithms in-memory.
 *
 * Run: pnpm --filter @shopguard/web test -- --run performance
 */

import { describe, it, expect } from 'vitest'
import {
  detectColumnMappings,
  inspectCSV,
  parseTimestamp,
  parseAmount,
} from '../lib/csv-import'
import { evaluateRisk, RULES, type RuleContext } from '../lib/risk-engine'
import type { Transaction, EmployeeBaseline, StoreBaseline } from '@shopguard/types'

// ==================== HELPERS ====================

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `tx-${Math.random().toString(36).slice(2)}`,
    organizationId: 'org-perf',
    storeId: 'store-perf',
    registerId: 'reg-perf',
    employeeId: 'emp-perf',
    timestamp: new Date('2025-06-15T14:00:00'),
    currency: 'PKR',
    grossAmount: 1000 + Math.random() * 4000,
    discountAmount: 0,
    refundAmount: 0,
    netAmount: 1000 + Math.random() * 4000,
    paymentMethod: 'cash',
    transactionStatus: 'COMPLETED',
    itemCount: 2,
    isVoid: false,
    isRefund: false,
    isNoSale: false,
    hasPriceOverride: false,
    source: 'csv',
    isDemo: false,
    ...overrides,
  }
}

function makeBaseline(txCount = 500): { emp: EmployeeBaseline; store: StoreBaseline } {
  return {
    emp: {
      employeeId: 'emp-perf',
      period: 'rolling_30d',
      confidence: 'HIGH',
      txCount,
      avgAmount: 1800,
      medianAmount: 1600,
      stdAmount: 600,
      txPerHour: 5,
      voidRate: 0.02,
      refundRate: 0.01,
      discountRate: 0.08,
      priceOverrideRate: 0.02,
      avgDiscountPct: 8,
    },
    store: {
      storeId: 'store-perf',
      period: 'rolling_30d',
      confidence: 'HIGH',
      txCount: txCount * 5,
      avgAmount: 1600,
      medianAmount: 1400,
      stdAmount: 700,
      voidRate: 0.02,
      refundRate: 0.015,
      discountRate: 0.07,
    },
  }
}

// Measure execution time
async function measure<T>(label: string, fn: () => T | Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now()
  const result = await fn()
  const ms = performance.now() - start
  return { result, ms }
}

// ==================== RISK ENGINE PERFORMANCE ====================

describe('Performance: Risk Engine', () => {
  it('evaluates 1,000 transactions in under 200ms', () => {
    const { emp, store } = makeBaseline()
    const recentTxns = Array.from({ length: 20 }, () => makeTx())

    const start = performance.now()
    let triggered = 0

    for (let i = 0; i < 1000; i++) {
      const tx = makeTx({ isVoid: i % 50 === 0 })
      const ctx: RuleContext = {
        transaction: tx,
        employeeBaseline: emp,
        storeBaseline: store,
        recentTransactions: recentTxns,
        sequenceTransactions: [],
      }
      const result = evaluateRisk(ctx)
      if (result.triggeredRules.length > 0) triggered++
    }

    const ms = performance.now() - start
    console.log(`Risk engine: 1,000 txns in ${ms.toFixed(1)}ms (${triggered} triggered)`)
    expect(ms).toBeLessThan(200)
  })

  it('evaluates 10,000 transactions in under 2,000ms', () => {
    const { emp, store } = makeBaseline()

    const start = performance.now()
    for (let i = 0; i < 10000; i++) {
      const tx = makeTx({
        isVoid: i % 50 === 0,
        discountPercent: i % 100 === 0 ? 60 : 0,
        paymentMethod: i % 3 === 0 ? 'cash' : 'card',
      })
      const ctx: RuleContext = {
        transaction: tx,
        employeeBaseline: emp,
        storeBaseline: store,
      }
      evaluateRisk(ctx)
    }

    const ms = performance.now() - start
    console.log(`Risk engine: 10,000 txns in ${ms.toFixed(1)}ms`)
    expect(ms).toBeLessThan(2000)
  })

  it('all 10 rules evaluate in <0.1ms each on average', () => {
    const { emp, store } = makeBaseline()
    const ctx: RuleContext = {
      transaction: makeTx(),
      employeeBaseline: emp,
      storeBaseline: store,
    }

    const iterations = 1000
    const start = performance.now()

    for (let i = 0; i < iterations; i++) {
      for (const rule of RULES) {
        rule.evaluate(ctx)
      }
    }

    const totalMs = performance.now() - start
    const avgPerRule = totalMs / (iterations * RULES.length)
    console.log(`Average per rule: ${avgPerRule.toFixed(3)}ms`)
    expect(avgPerRule).toBeLessThan(0.1)
  })
})

// ==================== CSV PERFORMANCE ====================

describe('Performance: CSV Processing', () => {
  function generateCSV(rows: number): string {
    const header = 'Transaction ID,Date,Amount,Cashier,Payment Method,Store,Register,Discount'
    const lines = [header]
    for (let i = 0; i < rows; i++) {
      const date = new Date(2025, 0, 1 + Math.floor(i / 100))
      lines.push(`TX${i.toString().padStart(6, '0')},${date.toISOString()},${(500 + Math.random() * 4500).toFixed(0)},Employee${i % 10},${i % 2 === 0 ? 'Cash' : 'Card'},Store${i % 3},Register${i % 4},${Math.random() < 0.1 ? (Math.random() * 20).toFixed(1) : 0}`)
    }
    return lines.join('\n')
  }

  it('parses 1,000 row CSV in under 500ms', async () => {
    const csv = generateCSV(1000)
    const { ms } = await measure('1k CSV parse', () => inspectCSV(csv))
    console.log(`CSV inspect 1,000 rows: ${ms.toFixed(1)}ms`)
    expect(ms).toBeLessThan(500)
  })

  it('detects column mappings from 20 headers in under 5ms', () => {
    const headers = [
      'Transaction ID', 'Date', 'Total', 'Staff Name', 'Payment Method',
      'Branch', 'Terminal', 'Discount', 'Refund', 'Voided',
      'Items', 'Status', 'Notes', 'External Ref', 'Customer',
      'Tax', 'Tip', 'Store', 'Register Code', 'Shift',
    ]
    const start = performance.now()
    detectColumnMappings(headers)
    const ms = performance.now() - start
    console.log(`Column detection 20 headers: ${ms.toFixed(2)}ms`)
    expect(ms).toBeLessThan(5)
  })

  it('parses 10,000 amounts in under 100ms', () => {
    const values = Array.from({ length: 10000 }, (_, i) =>
      `PKR ${(Math.random() * 50000).toFixed(2)}`
    )

    const start = performance.now()
    let parsed = 0
    for (const v of values) {
      const result = parseAmount(v)
      if (result !== null) parsed++
    }
    const ms = performance.now() - start

    console.log(`Amount parsing 10,000: ${ms.toFixed(1)}ms (${parsed} parsed)`)
    expect(ms).toBeLessThan(100)
    expect(parsed).toBeGreaterThan(9000) // Most should parse
  })

  it('parses 10,000 timestamps in under 200ms', () => {
    const formats = [
      '2025-01-15T14:30:00',
      '15/01/2025 14:30',
      '2025-06-01',
      '01-15-2025 09:00',
    ]

    const start = performance.now()
    let parsed = 0
    for (let i = 0; i < 10000; i++) {
      const fmt = formats[i % formats.length]
      const result = parseTimestamp(fmt)
      if (result !== null) parsed++
    }
    const ms = performance.now() - start

    console.log(`Timestamp parsing 10,000: ${ms.toFixed(1)}ms (${parsed} parsed)`)
    expect(ms).toBeLessThan(200)
    expect(parsed).toBeGreaterThan(9500)
  })
})

// ==================== INCIDENT CORRELATION PERFORMANCE ====================

describe('Performance: Incident Correlation', () => {
  // Simulate correlation algorithm
  type PendingItem = { transactionId: string; employeeId: string; registerId: string; timestamp: Date; score: number }
  function correlate(pending: PendingItem[]): PendingItem[][] {
    const WINDOW_MS = 30 * 60 * 1000
    const groups: PendingItem[][] = []
    const assigned = new Set<number>()

    for (let i = 0; i < pending.length; i++) {
      if (assigned.has(i)) continue
      const group: PendingItem[] = [pending[i]]
      assigned.add(i)

      for (let j = i + 1; j < pending.length; j++) {
        if (assigned.has(j)) continue
        const a = pending[i]
        const b = pending[j]
        const timeDiff = Math.abs(a.timestamp.getTime() - b.timestamp.getTime())
        if (timeDiff < WINDOW_MS && (a.employeeId === b.employeeId || a.registerId === b.registerId)) {
          group.push(b)
          assigned.add(j)
        }
      }
      groups.push(group)
    }
    return groups
  }

  it('correlates 100 triggered transactions in under 50ms', () => {
    const pending = Array.from({ length: 100 }, (_, i) => ({
      transactionId: `tx-${i}`,
      employeeId: `emp-${i % 10}`,
      registerId: `reg-${i % 5}`,
      timestamp: new Date(2025, 0, 15, 14, i, 0),
      score: 0.6 + Math.random() * 0.3,
    }))

    const corrStart = performance.now()
    correlate(pending)
    const ms = performance.now() - corrStart
    console.log(`Correlation 100 transactions: ${ms.toFixed(2)}ms`)
    expect(ms).toBeLessThan(50)
  })

  it('correlates 1,000 triggered transactions in under 500ms', () => {
    const pending = Array.from({ length: 1000 }, (_, i) => ({
      transactionId: `tx-${i}`,
      employeeId: `emp-${i % 20}`,
      registerId: `reg-${i % 10}`,
      timestamp: new Date(2025, 0, 15, Math.floor(i / 60) % 24, i % 60, 0),
      score: 0.5 + Math.random() * 0.4,
    }))

    const corrStart = performance.now()
    correlate(pending)
    const ms = performance.now() - corrStart
    console.log(`Correlation 1,000 transactions: ${ms.toFixed(1)}ms`)
    expect(ms).toBeLessThan(500)
  })
})

// ==================== MEMORY ====================

describe('Performance: Memory Efficiency', () => {
  it('risk evaluation does not leak memory across 50,000 transactions', () => {
    const { emp, store } = makeBaseline()
    const initialMemory = process.memoryUsage().heapUsed

    for (let i = 0; i < 50000; i++) {
      const ctx: RuleContext = {
        transaction: makeTx(),
        employeeBaseline: emp,
        storeBaseline: store,
      }
      evaluateRisk(ctx)
    }

    // Force GC hint (not guaranteed but helps)
    if (global.gc) global.gc()

    const finalMemory = process.memoryUsage().heapUsed
    const growthMB = (finalMemory - initialMemory) / 1024 / 1024
    console.log(`Memory growth over 50k evaluations: ${growthMB.toFixed(1)}MB`)
    // Should not grow more than 50MB (objects should be GC'd)
    expect(growthMB).toBeLessThan(50)
  })
})
