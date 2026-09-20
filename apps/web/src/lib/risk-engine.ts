import { isCashPayment } from './payment-methods'
// ShopGuard Risk Engine - Modular, Testable Rules

import type { Transaction, RuleResult, RiskScore, RiskLevel, EmployeeBaseline, StoreBaseline } from '@shopguard/types'

export interface RuleContext {
  transaction: Transaction
  employeeBaseline?: EmployeeBaseline
  storeBaseline?: StoreBaseline
  recentTransactions?: Transaction[] // last 24h for same employee
  sequenceTransactions?: Transaction[] // nearby transactions on same register
}

// ==================== RULE DEFINITIONS ====================

export type Rule = {
  id: string
  name: string
  description: string
  defaultEnabled: boolean
  defaultSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  evaluate: (ctx: RuleContext, thresholds?: Record<string, number>) => RuleResult
}

// Rule 1: Void after cash payment
const voidAfterCashPayment: Rule = {
  id: 'void_after_cash',
  name: 'Void After Cash Payment',
  description: 'A void occurred shortly after a cash payment',
  defaultEnabled: true,
  defaultSeverity: 'HIGH',
  evaluate: (ctx, thresholds) => {
    const tx = ctx.transaction
    const maxSeconds = thresholds?.maxSeconds ?? 120
    
    if (!tx.isVoid || tx.paymentMethod !== 'cash') {
      return { ruleId: 'void_after_cash', triggered: false, severity: 'HIGH', evidence: '', scoreContribution: 0 }
    }
    
    // Check if there was a cash transaction just before
    const prevCash = ctx.sequenceTransactions?.find(
      t => !t.isVoid && t.paymentMethod === 'cash' &&
      new Date(tx.timestamp).getTime() - new Date(t.timestamp).getTime() < maxSeconds * 1000
    )
    
    if (prevCash) {
      const seconds = Math.round((new Date(tx.timestamp).getTime() - new Date(prevCash.timestamp).getTime()) / 1000)
      return {
        ruleId: 'void_after_cash',
        triggered: true,
        severity: 'HIGH',
        evidence: `Void occurred ${seconds} seconds after a cash payment`,
        scoreContribution: 0.35,
        metadata: { delaySeconds: seconds, previousTxId: prevCash.id }
      }
    }
    
    return { ruleId: 'void_after_cash', triggered: false, severity: 'HIGH', evidence: '', scoreContribution: 0 }
  }
}

// Rule 2: No-sale drawer opening
const noSaleDrawer: Rule = {
  id: 'no_sale_drawer',
  name: 'No-Sale Drawer Opening',
  description: 'Cash drawer opened without a sale',
  defaultEnabled: true,
  defaultSeverity: 'MEDIUM',
  evaluate: (ctx) => {
    const tx = ctx.transaction
    if (!tx.isNoSale) {
      return { ruleId: 'no_sale_drawer', triggered: false, severity: 'MEDIUM', evidence: '', scoreContribution: 0 }
    }
    
    // Check rate against baseline
    const empBaseline = ctx.employeeBaseline
    const rate = 0 // would come from baseline
    
    return {
      ruleId: 'no_sale_drawer',
      triggered: true,
      severity: 'MEDIUM',
      evidence: `No-sale drawer opening detected${empBaseline ? ` for employee with ${(Number(empBaseline.voidRate ?? 0) * 100).toFixed(1)}% baseline void rate` : ''}`,
      scoreContribution: 0.2,
    }
  }
}

// Rule 3: Repeated voids (employee void rate above baseline)
const repeatedVoids: Rule = {
  id: 'repeated_voids',
  name: 'Repeated Voids',
  description: "Employee's void rate is significantly above their recent baseline",
  defaultEnabled: true,
  defaultSeverity: 'HIGH',
  evaluate: (ctx, thresholds) => {
    const tx = ctx.transaction
    const empBaseline = ctx.employeeBaseline
    const storeBaseline = ctx.storeBaseline
    
    if (!empBaseline || empBaseline.txCount < 20) {
      return { ruleId: 'repeated_voids', triggered: false, severity: 'HIGH', evidence: '', scoreContribution: 0 }
    }
    
    // Calculate employee's current void rate from recent transactions
    const recentVoids = ctx.recentTransactions?.filter(t => t.isVoid).length ?? 0
    const recentTotal = ctx.recentTransactions?.length ?? 0
    if (recentTotal < 5) {
      return { ruleId: 'repeated_voids', triggered: false, severity: 'HIGH', evidence: '', scoreContribution: 0 }
    }
    
    const currentVoidRate = recentVoids / recentTotal
    const baselineVoidRate = Number(empBaseline.voidRate ?? 0)
    const storeVoidRate = Number(storeBaseline?.voidRate ?? baselineVoidRate)
    const multiplier = thresholds?.multiplier ?? 2.5
    
    const isHighVsPersonal = baselineVoidRate > 0 && currentVoidRate > baselineVoidRate * multiplier
    const isHighVsStore = storeVoidRate > 0 && currentVoidRate > storeVoidRate * multiplier
    
    if (isHighVsPersonal || isHighVsStore) {
      const pct = (currentVoidRate * 100).toFixed(1)
      const basePct = (baselineVoidRate * 100).toFixed(1)
      return {
        ruleId: 'repeated_voids',
        triggered: true,
        severity: 'HIGH',
        evidence: `Employee void rate (${pct}%) is ${(currentVoidRate / Math.max(baselineVoidRate, 0.001)).toFixed(1)}x above their recent baseline (${basePct}%)`,
        scoreContribution: 0.3,
        metadata: { currentVoidRate, baselineVoidRate, storeVoidRate }
      }
    }
    
    return { ruleId: 'repeated_voids', triggered: false, severity: 'HIGH', evidence: '', scoreContribution: 0 }
  }
}

// Rule 4: Large refund
const largeRefund: Rule = {
  id: 'large_refund',
  name: 'Large Refund',
  description: 'Refund amount is unusually high compared to store patterns',
  defaultEnabled: true,
  defaultSeverity: 'HIGH',
  evaluate: (ctx, thresholds) => {
    const tx = ctx.transaction
    if (!tx.isRefund || tx.refundAmount <= 0) {
      return { ruleId: 'large_refund', triggered: false, severity: 'HIGH', evidence: '', scoreContribution: 0 }
    }
    
    const storeBaseline = ctx.storeBaseline
    const absThreshold = thresholds?.absoluteThreshold ?? 5000 // PKR
    const stdMultiplier = thresholds?.stdMultiplier ?? 3
    
    let triggered = tx.refundAmount > absThreshold
    let evidence = ''
    
    if (storeBaseline?.avgAmount && storeBaseline?.stdAmount) {
      const avgAmount = Number(storeBaseline.avgAmount)
      const stdAmount = Number(storeBaseline.stdAmount)
      if (tx.refundAmount > avgAmount + stdMultiplier * stdAmount) {
        triggered = true
        evidence = `Refund amount (${tx.currency} ${tx.refundAmount.toFixed(0)}) is ${stdMultiplier}+ standard deviations above store average transaction`
      }
    }
    
    if (triggered && !evidence) {
      evidence = `Refund amount (${tx.currency} ${tx.refundAmount.toFixed(0)}) exceeds threshold`
    }
    
    return {
      ruleId: 'large_refund',
      triggered,
      severity: 'HIGH',
      evidence,
      scoreContribution: triggered ? 0.25 : 0,
    }
  }
}

// Rule 5: Rapid sale then refund
const rapidSaleRefund: Rule = {
  id: 'rapid_sale_refund',
  name: 'Rapid Sale-Refund Sequence',
  description: 'A sale was followed by a refund in a very short time',
  defaultEnabled: true,
  defaultSeverity: 'HIGH',
  evaluate: (ctx, thresholds) => {
    const tx = ctx.transaction
    const maxMinutes = thresholds?.maxMinutes ?? 5
    
    if (!tx.isRefund) {
      return { ruleId: 'rapid_sale_refund', triggered: false, severity: 'HIGH', evidence: '', scoreContribution: 0 }
    }
    
    const prevSale = ctx.sequenceTransactions?.find(
      t => !t.isRefund && !t.isVoid &&
      new Date(tx.timestamp).getTime() - new Date(t.timestamp).getTime() < maxMinutes * 60 * 1000
    )
    
    if (prevSale) {
      const minutes = Math.round((new Date(tx.timestamp).getTime() - new Date(prevSale.timestamp).getTime()) / 60000)
      return {
        ruleId: 'rapid_sale_refund',
        triggered: true,
        severity: 'HIGH',
        evidence: `Refund occurred ${minutes} minute(s) after a sale — unusually fast for a legitimate return`,
        scoreContribution: 0.3,
        metadata: { delayMinutes: minutes, saleId: prevSale.id }
      }
    }
    
    return { ruleId: 'rapid_sale_refund', triggered: false, severity: 'HIGH', evidence: '', scoreContribution: 0 }
  }
}

// Rule 6: Excessive discount
const excessiveDiscount: Rule = {
  id: 'excessive_discount',
  name: 'Excessive Discount',
  description: 'Discount percentage is unusually high',
  defaultEnabled: true,
  defaultSeverity: 'MEDIUM',
  evaluate: (ctx, thresholds) => {
    const tx = ctx.transaction
    const maxDiscountPct = thresholds?.maxDiscountPct ?? 30
    
    const discountPct = Number(tx.discountPercent ?? 0)
    if (discountPct <= maxDiscountPct) {
      return { ruleId: 'excessive_discount', triggered: false, severity: 'MEDIUM', evidence: '', scoreContribution: 0 }
    }
    
    // Compare to employee baseline
    const empBaseline = ctx.employeeBaseline
    const baselineDiscount = Number(empBaseline?.avgDiscountPct ?? 0)
    
    const evidence = discountPct > 50
      ? `Extreme discount of ${discountPct.toFixed(1)}% applied — significantly above typical range`
      : `Discount of ${discountPct.toFixed(1)}% exceeds threshold${baselineDiscount > 0 ? ` (employee average: ${baselineDiscount.toFixed(1)}%)` : ''}`
    
    return {
      ruleId: 'excessive_discount',
      triggered: true,
      severity: discountPct > 50 ? 'HIGH' : 'MEDIUM',
      evidence,
      scoreContribution: discountPct > 50 ? 0.3 : 0.15,
    }
  }
}

// Rule 7: Price override
const priceOverride: Rule = {
  id: 'price_override',
  name: 'Price Override',
  description: 'Manual price override was applied',
  defaultEnabled: true,
  defaultSeverity: 'MEDIUM',
  evaluate: (ctx) => {
    const tx = ctx.transaction
    if (!tx.hasPriceOverride) {
      return { ruleId: 'price_override', triggered: false, severity: 'MEDIUM', evidence: '', scoreContribution: 0 }
    }
    
    const empBaseline = ctx.employeeBaseline
    const empPriceOverrideRate = Number(empBaseline?.priceOverrideRate ?? 0)
    
    return {
      ruleId: 'price_override',
      triggered: true,
      severity: 'MEDIUM',
      evidence: `Manual price override applied${empPriceOverrideRate > 0 ? ` (employee rate: ${(empPriceOverrideRate * 100).toFixed(1)}%)` : ''}`,
      scoreContribution: 0.15,
    }
  }
}

// Rule 8: After-hours transaction
const afterHours: Rule = {
  id: 'after_hours',
  name: 'After-Hours Transaction',
  description: 'Transaction occurred outside normal store hours',
  defaultEnabled: true,
  defaultSeverity: 'MEDIUM',
  evaluate: (ctx, thresholds) => {
    const tx = ctx.transaction
    const openHour = thresholds?.openHour ?? 8
    const closeHour = thresholds?.closeHour ?? 22
    
    const hour = new Date(tx.timestamp).getHours()
    if (hour >= openHour && hour < closeHour) {
      return { ruleId: 'after_hours', triggered: false, severity: 'MEDIUM', evidence: '', scoreContribution: 0 }
    }
    
    return {
      ruleId: 'after_hours',
      triggered: true,
      severity: hour < 6 || hour >= 23 ? 'HIGH' : 'MEDIUM',
      evidence: `Transaction at ${hour.toString().padStart(2, '0')}:00 is outside normal operating hours (${openHour}:00–${closeHour}:00)`,
      scoreContribution: 0.25,
    }
  }
}

// Rule 9: Unusual transaction amount
const unusualAmount: Rule = {
  id: 'unusual_amount',
  name: 'Unusual Transaction Amount',
  description: 'Transaction amount is statistically unusual for this store or employee',
  defaultEnabled: true,
  defaultSeverity: 'LOW',
  evaluate: (ctx, thresholds) => {
    const tx = ctx.transaction
    const storeBaseline = ctx.storeBaseline
    const empBaseline = ctx.employeeBaseline
    const stdMultiplier = thresholds?.stdMultiplier ?? 4
    
    if (!storeBaseline?.avgAmount || !storeBaseline?.stdAmount) {
      return { ruleId: 'unusual_amount', triggered: false, severity: 'LOW', evidence: '', scoreContribution: 0 }
    }
    
    const avg = Number(storeBaseline.avgAmount)
    const std = Number(storeBaseline.stdAmount)
    const deviation = Math.abs(tx.netAmount - avg) / Math.max(std, 1)
    
    if (deviation < stdMultiplier) {
      return { ruleId: 'unusual_amount', triggered: false, severity: 'LOW', evidence: '', scoreContribution: 0 }
    }
    
    return {
      ruleId: 'unusual_amount',
      triggered: true,
      severity: deviation > stdMultiplier * 2 ? 'HIGH' : 'MEDIUM',
      evidence: `Transaction amount (${tx.currency} ${tx.netAmount.toFixed(0)}) is ${deviation.toFixed(1)} standard deviations from store average (${tx.currency} ${avg.toFixed(0)})`,
      scoreContribution: Math.min(0.2, deviation * 0.03),
    }
  }
}

// Rule 10: Cash variance
const cashVariance: Rule = {
  id: 'cash_variance',
  name: 'Cash Variance',
  description: 'Counted cash differs significantly from expected cash',
  defaultEnabled: true,
  defaultSeverity: 'HIGH',
  evaluate: (ctx, thresholds) => {
    // This rule is evaluated at cash session level, not transaction level
    return { ruleId: 'cash_variance', triggered: false, severity: 'HIGH', evidence: '', scoreContribution: 0 }
  }
}

// ==================== RULE REGISTRY ====================

export const RULES: Rule[] = [
  voidAfterCashPayment,
  noSaleDrawer,
  repeatedVoids,
  largeRefund,
  rapidSaleRefund,
  excessiveDiscount,
  priceOverride,
  afterHours,
  unusualAmount,
  cashVariance,
]

export function getRuleById(id: string): Rule | undefined {
  return RULES.find(r => r.id === id)
}

// ==================== RISK ENGINE ====================

export function evaluateRisk(
  ctx: RuleContext,
  enabledRuleIds?: string[],
  ruleThresholds?: Record<string, Record<string, number>>
): RiskScore {
  const enabledRules = enabledRuleIds
    ? RULES.filter(r => enabledRuleIds.includes(r.id))
    : RULES.filter(r => r.defaultEnabled)
  
  const results = enabledRules.map(rule => {
    const thresholds = ruleThresholds?.[rule.id]
    return rule.evaluate(ctx, thresholds)
  })
  
  const triggered = results.filter(r => r.triggered)
  
  // Calculate composite score
  const ruleScore = triggered.reduce((sum, r) => sum + r.scoreContribution, 0)
  
  // Baseline anomaly score
  let baselineScore = 0
  if (ctx.employeeBaseline && ctx.recentTransactions) {
    const empBaseline = ctx.employeeBaseline
    if (empBaseline.txCount >= 20) {
      const recentVoidRate = ctx.recentTransactions.filter(t => t.isVoid).length / Math.max(ctx.recentTransactions.length, 1)
      const baselineVoidRate = Number(empBaseline.voidRate ?? 0)
      if (baselineVoidRate > 0 && recentVoidRate > baselineVoidRate * 2) {
        baselineScore += 0.15
      }
    }
  }
  
  // ML score placeholder (0 = no ML model)
  const mlScore = 0
  
  const totalScore = Math.min(1, ruleScore + baselineScore * 0.3 + mlScore * 0.2)
  
  let riskLevel: RiskLevel
  if (totalScore >= 0.5) riskLevel = 'HIGH'
  else if (totalScore >= 0.25) riskLevel = 'MEDIUM'
  else riskLevel = 'LOW'
  
  return {
    ruleScore,
    baselineScore,
    mlScore,
    totalScore,
    riskLevel,
    triggeredRules: triggered,
    evidenceItems: triggered.map(r => r.evidence).filter(Boolean),
  }
}

export function scoreToSeverity(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (score >= 0.75) return 'CRITICAL'
  if (score >= 0.5) return 'HIGH'
  if (score >= 0.25) return 'MEDIUM'
  return 'LOW'
}
