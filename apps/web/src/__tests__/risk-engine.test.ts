import { describe, it, expect } from 'vitest'
import { RULES, evaluateRisk, getRuleById, type RuleContext } from '../lib/risk-engine'
import type { Transaction, EmployeeBaseline, StoreBaseline } from '@shopguard/types'

// ==================== TEST HELPERS ====================

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    organizationId: 'org-1',
    storeId: 'store-1',
    registerId: 'reg-1',
    employeeId: 'emp-1',
    timestamp: new Date('2025-01-15T14:00:00'),
    currency: 'PKR',
    grossAmount: 1000,
    discountAmount: 0,
    refundAmount: 0,
    netAmount: 1000,
    paymentMethod: 'card',
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

function makeEmpBaseline(overrides: Partial<EmployeeBaseline> = {}): EmployeeBaseline {
  return {
    employeeId: 'emp-1',
    period: 'rolling_30d',
    confidence: 'HIGH',
    txCount: 500,
    avgAmount: 1200,
    medianAmount: 1000,
    stdAmount: 400,
    txPerHour: 5,
    voidRate: 0.02,
    refundRate: 0.01,
    discountRate: 0.08,
    priceOverrideRate: 0.02,
    avgDiscountPct: 8,
    ...overrides,
  }
}

function makeStoreBaseline(overrides: Partial<StoreBaseline> = {}): StoreBaseline {
  return {
    storeId: 'store-1',
    period: 'rolling_30d',
    confidence: 'HIGH',
    txCount: 5000,
    avgAmount: 1300,
    medianAmount: 1100,
    stdAmount: 450,
    voidRate: 0.02,
    refundRate: 0.015,
    discountRate: 0.07,
    ...overrides,
  }
}

// ==================== RULE TESTS ====================

describe('Rule: void_after_cash', () => {
  const rule = getRuleById('void_after_cash')!

  it('does not trigger for non-void transactions', () => {
    const ctx: RuleContext = {
      transaction: makeTx({ paymentMethod: 'cash', isVoid: false }),
    }
    expect(rule.evaluate(ctx).triggered).toBe(false)
  })

  it('does not trigger for void without preceding cash', () => {
    const prevCard = makeTx({ id: 'tx-prev', paymentMethod: 'card', isVoid: false })
    const ctx: RuleContext = {
      transaction: makeTx({ paymentMethod: 'cash', isVoid: true }),
      sequenceTransactions: [prevCard],
    }
    expect(rule.evaluate(ctx).triggered).toBe(false)
  })

  it('triggers when void follows cash payment within window', () => {
    const cashTx = makeTx({
      id: 'tx-cash',
      paymentMethod: 'cash',
      isVoid: false,
      timestamp: new Date('2025-01-15T14:00:00'),
    })
    const voidTx = makeTx({
      paymentMethod: 'cash',
      isVoid: true,
      timestamp: new Date('2025-01-15T14:00:30'), // 30 seconds later
    })
    const ctx: RuleContext = {
      transaction: voidTx,
      sequenceTransactions: [cashTx],
    }
    const result = rule.evaluate(ctx)
    expect(result.triggered).toBe(true)
    expect(result.evidence).toContain('30 seconds')
    expect(result.scoreContribution).toBeGreaterThan(0)
  })

  it('does not trigger when void is outside time window', () => {
    const cashTx = makeTx({
      id: 'tx-cash',
      paymentMethod: 'cash',
      isVoid: false,
      timestamp: new Date('2025-01-15T13:00:00'),
    })
    const voidTx = makeTx({
      paymentMethod: 'cash',
      isVoid: true,
      timestamp: new Date('2025-01-15T14:00:00'), // 60 minutes later
    })
    const ctx: RuleContext = {
      transaction: voidTx,
      sequenceTransactions: [cashTx],
    }
    expect(rule.evaluate(ctx).triggered).toBe(false)
  })
})

describe('Rule: no_sale_drawer', () => {
  const rule = getRuleById('no_sale_drawer')!

  it('does not trigger for normal sales', () => {
    const ctx: RuleContext = { transaction: makeTx({ isNoSale: false }) }
    expect(rule.evaluate(ctx).triggered).toBe(false)
  })

  it('triggers for no-sale events', () => {
    const ctx: RuleContext = { transaction: makeTx({ isNoSale: true }) }
    const result = rule.evaluate(ctx)
    expect(result.triggered).toBe(true)
    expect(result.scoreContribution).toBeGreaterThan(0)
  })
})

describe('Rule: repeated_voids', () => {
  const rule = getRuleById('repeated_voids')!

  it('does not trigger without baseline', () => {
    const ctx: RuleContext = { transaction: makeTx({ isVoid: true }) }
    expect(rule.evaluate(ctx).triggered).toBe(false)
  })

  it('does not trigger when sample size is too small', () => {
    const ctx: RuleContext = {
      transaction: makeTx(),
      employeeBaseline: makeEmpBaseline({ txCount: 10, confidence: 'LOW' }),
    }
    expect(rule.evaluate(ctx).triggered).toBe(false)
  })

  it('triggers when current void rate far exceeds baseline', () => {
    // 10 of 20 recent = 50% void rate vs 2% baseline
    const recentTxns = [
      ...Array(10).fill(null).map((_, i) => makeTx({ id: `tx-${i}`, isVoid: true })),
      ...Array(10).fill(null).map((_, i) => makeTx({ id: `tx-n${i}`, isVoid: false })),
    ]
    const ctx: RuleContext = {
      transaction: makeTx(),
      employeeBaseline: makeEmpBaseline({ txCount: 300, voidRate: 0.02, confidence: 'HIGH' }),
      storeBaseline: makeStoreBaseline({ voidRate: 0.02 }),
      recentTransactions: recentTxns,
    }
    const result = rule.evaluate(ctx)
    expect(result.triggered).toBe(true)
    expect(result.evidence).toContain('void rate')
  })

  it('does not trigger when void rate is within normal range', () => {
    const recentTxns = [
      ...Array(1).fill(null).map((_, i) => makeTx({ id: `tx-${i}`, isVoid: true })),
      ...Array(49).fill(null).map((_, i) => makeTx({ id: `tx-n${i}`, isVoid: false })),
    ]
    const ctx: RuleContext = {
      transaction: makeTx(),
      employeeBaseline: makeEmpBaseline({ txCount: 300, voidRate: 0.02, confidence: 'HIGH' }),
      recentTransactions: recentTxns,
    }
    expect(rule.evaluate(ctx).triggered).toBe(false)
  })
})

describe('Rule: large_refund', () => {
  const rule = getRuleById('large_refund')!

  it('does not trigger for non-refund transactions', () => {
    const ctx: RuleContext = { transaction: makeTx({ isRefund: false, refundAmount: 0 }) }
    expect(rule.evaluate(ctx).triggered).toBe(false)
  })

  it('triggers for refund above absolute threshold', () => {
    const ctx: RuleContext = {
      transaction: makeTx({ isRefund: true, refundAmount: 8000 }),
    }
    expect(rule.evaluate(ctx).triggered).toBe(true)
  })

  it('triggers when refund exceeds statistical store threshold', () => {
    const ctx: RuleContext = {
      transaction: makeTx({ isRefund: true, refundAmount: 5000 }),
      storeBaseline: makeStoreBaseline({ avgAmount: 800, stdAmount: 300 }),
    }
    // 5000 > 800 + 3*300 = 1700 → triggered
    expect(rule.evaluate(ctx).triggered).toBe(true)
  })

  it('does not trigger for small refund within store pattern', () => {
    const ctx: RuleContext = {
      transaction: makeTx({ isRefund: true, refundAmount: 500 }),
      storeBaseline: makeStoreBaseline({ avgAmount: 2000, stdAmount: 800 }),
    }
    // 500 < 2000 + 3*800 = 4400 and < 5000 threshold
    expect(rule.evaluate(ctx).triggered).toBe(false)
  })
})

describe('Rule: rapid_sale_refund', () => {
  const rule = getRuleById('rapid_sale_refund')!

  it('triggers when refund follows sale within window', () => {
    const saleTx = makeTx({
      id: 'sale-1',
      isRefund: false,
      isVoid: false,
      timestamp: new Date('2025-01-15T14:00:00'),
    })
    const refundTx = makeTx({
      isRefund: true,
      timestamp: new Date('2025-01-15T14:02:00'), // 2 min later
    })
    const ctx: RuleContext = {
      transaction: refundTx,
      sequenceTransactions: [saleTx],
    }
    expect(rule.evaluate(ctx).triggered).toBe(true)
  })

  it('does not trigger for refund much later', () => {
    const saleTx = makeTx({
      id: 'sale-1',
      isRefund: false,
      timestamp: new Date('2025-01-15T10:00:00'),
    })
    const refundTx = makeTx({
      isRefund: true,
      timestamp: new Date('2025-01-15T14:00:00'), // 4 hours later
    })
    const ctx: RuleContext = {
      transaction: refundTx,
      sequenceTransactions: [saleTx],
    }
    expect(rule.evaluate(ctx).triggered).toBe(false)
  })
})

describe('Rule: excessive_discount', () => {
  const rule = getRuleById('excessive_discount')!

  it('does not trigger for normal discounts', () => {
    const ctx: RuleContext = {
      transaction: makeTx({ discountPercent: 10 }),
    }
    expect(rule.evaluate(ctx).triggered).toBe(false)
  })

  it('triggers for extreme discounts', () => {
    const ctx: RuleContext = {
      transaction: makeTx({ discountPercent: 65 }),
    }
    const result = rule.evaluate(ctx)
    expect(result.triggered).toBe(true)
    expect(result.severity).toBe('HIGH')
  })

  it('triggers at threshold', () => {
    const ctx: RuleContext = {
      transaction: makeTx({ discountPercent: 31 }),
    }
    expect(rule.evaluate(ctx).triggered).toBe(true)
  })
})

describe('Rule: after_hours', () => {
  const rule = getRuleById('after_hours')!

  it('does not trigger during business hours', () => {
    const ctx: RuleContext = {
      transaction: makeTx({ timestamp: new Date('2025-01-15T10:00:00') }),
    }
    expect(rule.evaluate(ctx).triggered).toBe(false)
  })

  it('triggers at midnight', () => {
    const ctx: RuleContext = {
      transaction: makeTx({ timestamp: new Date('2025-01-15T00:30:00') }),
    }
    const result = rule.evaluate(ctx)
    expect(result.triggered).toBe(true)
    expect(result.severity).toBe('HIGH')
  })

  it('triggers late evening', () => {
    const ctx: RuleContext = {
      transaction: makeTx({ timestamp: new Date('2025-01-15T23:00:00') }),
    }
    expect(rule.evaluate(ctx).triggered).toBe(true)
  })

  it('triggers early morning', () => {
    const ctx: RuleContext = {
      transaction: makeTx({ timestamp: new Date('2025-01-15T06:00:00') }),
    }
    expect(rule.evaluate(ctx).triggered).toBe(true)
  })
})

describe('Rule: price_override', () => {
  const rule = getRuleById('price_override')!

  it('does not trigger without price override', () => {
    const ctx: RuleContext = { transaction: makeTx({ hasPriceOverride: false }) }
    expect(rule.evaluate(ctx).triggered).toBe(false)
  })

  it('triggers for price overrides', () => {
    const ctx: RuleContext = { transaction: makeTx({ hasPriceOverride: true }) }
    expect(rule.evaluate(ctx).triggered).toBe(true)
  })
})

describe('Rule: unusual_amount', () => {
  const rule = getRuleById('unusual_amount')!

  it('does not trigger without baseline', () => {
    const ctx: RuleContext = {
      transaction: makeTx({ netAmount: 100000 }),
    }
    expect(rule.evaluate(ctx).triggered).toBe(false)
  })

  it('triggers for statistically extreme amounts', () => {
    const ctx: RuleContext = {
      transaction: makeTx({ netAmount: 50000 }),
      storeBaseline: makeStoreBaseline({ avgAmount: 1000, stdAmount: 300 }),
    }
    // 50000 is (50000-1000)/300 = 163 standard deviations away — definitely triggers
    expect(rule.evaluate(ctx).triggered).toBe(true)
  })

  it('does not trigger for normal amounts', () => {
    const ctx: RuleContext = {
      transaction: makeTx({ netAmount: 1200 }),
      storeBaseline: makeStoreBaseline({ avgAmount: 1000, stdAmount: 300 }),
    }
    // 1200 is 0.67 SD away — within normal
    expect(rule.evaluate(ctx).triggered).toBe(false)
  })
})

// ==================== RISK AGGREGATION TESTS ====================

describe('evaluateRisk', () => {
  it('returns LOW risk when no rules trigger', () => {
    const ctx: RuleContext = {
      transaction: makeTx(),
    }
    const result = evaluateRisk(ctx)
    expect(result.riskLevel).toBe('LOW')
    expect(result.triggeredRules).toHaveLength(0)
  })

  it('returns HIGH risk for void-after-cash with high-rate employee', () => {
    const cashTx = makeTx({
      id: 'cash-prev',
      paymentMethod: 'cash',
      timestamp: new Date('2025-01-15T14:00:00'),
    })
    const recentVoids = [
      ...Array(15).fill(null).map((_, i) => makeTx({ id: `v${i}`, isVoid: true })),
      ...Array(5).fill(null).map((_, i) => makeTx({ id: `n${i}`, isVoid: false })),
    ]
    const ctx: RuleContext = {
      transaction: makeTx({
        paymentMethod: 'cash',
        isVoid: true,
        timestamp: new Date('2025-01-15T14:00:45'),
      }),
      sequenceTransactions: [cashTx],
      recentTransactions: recentVoids,
      employeeBaseline: makeEmpBaseline({ txCount: 400, voidRate: 0.02, confidence: 'HIGH' }),
      storeBaseline: makeStoreBaseline({ voidRate: 0.02 }),
    }
    const result = evaluateRisk(ctx)
    expect(result.riskLevel).toBe('HIGH')
    expect(result.totalScore).toBeGreaterThan(0.3)
  })

  it('combines evidence from multiple triggered rules', () => {
    const ctx: RuleContext = {
      transaction: makeTx({
        hasPriceOverride: true,
        discountPercent: 60,
        isNoSale: true,
      }),
    }
    const result = evaluateRisk(ctx)
    expect(result.triggeredRules.length).toBeGreaterThan(1)
    expect(result.evidenceItems.length).toBeGreaterThan(1)
  })

  it('respects enabled rule list', () => {
    const ctx: RuleContext = {
      transaction: makeTx({ hasPriceOverride: true }),
    }
    // Only enable after_hours (which won't trigger at hour 14)
    const result = evaluateRisk(ctx, ['after_hours'])
    expect(result.triggeredRules).toHaveLength(0)
    expect(result.riskLevel).toBe('LOW')
  })
})

// ==================== RULE REGISTRY TESTS ====================

describe('RULES registry', () => {
  it('has at least 10 rules', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(10)
  })

  it('all rules have required fields', () => {
    for (const rule of RULES) {
      expect(rule.id).toBeTruthy()
      expect(rule.name).toBeTruthy()
      expect(rule.description).toBeTruthy()
      expect(typeof rule.evaluate).toBe('function')
      expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(rule.defaultSeverity)
    }
  })

  it('rule IDs are unique', () => {
    const ids = RULES.map(r => r.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('all rules return structured evidence', () => {
    const ctx: RuleContext = { transaction: makeTx() }
    for (const rule of RULES) {
      const result = rule.evaluate(ctx)
      expect(typeof result.triggered).toBe('boolean')
      expect(typeof result.scoreContribution).toBe('number')
      expect(result.scoreContribution).toBeGreaterThanOrEqual(0)
      expect(result.scoreContribution).toBeLessThanOrEqual(1)
    }
  })
})
