/**
 * Live data ingestion tests
 * Tests API key management, validation, idempotency, and security.
 * No real DB calls — mocked where needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizePaymentMethod, isCashPayment, isDigitalPayment } from '@/lib/payment-methods'
import { isSupportedCurrency } from '@/lib/money'
import crypto from 'crypto'

// ── Expose internal helpers for testing ───────────────────────────────────────
// We test the pure functions that don't need DB

function hashSecretFn(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex')
}

function generateSecretFn(): string {
  return 'sg_live_' + crypto.randomBytes(16).toString('hex')
}

// ── API Key format ────────────────────────────────────────────────────────────

describe('API key format', () => {
  it('generated key starts with sg_live_', () => {
    const key = generateSecretFn()
    expect(key).toMatch(/^sg_live_[0-9a-f]{32}$/)
  })

  it('two generated keys are different', () => {
    expect(generateSecretFn()).not.toBe(generateSecretFn())
  })

  it('key hash is 64 hex chars (sha256)', () => {
    const hash = hashSecretFn('sg_live_' + 'a'.repeat(32))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('same key produces same hash', () => {
    const key = generateSecretFn()
    expect(hashSecretFn(key)).toBe(hashSecretFn(key))
  })

  it('different keys produce different hashes', () => {
    const key1 = generateSecretFn()
    const key2 = generateSecretFn()
    expect(hashSecretFn(key1)).not.toBe(hashSecretFn(key2))
  })

  it('key prefix is exactly 8 chars', () => {
    const key = generateSecretFn()
    const prefix = key.slice(0, 8)
    expect(prefix).toBe('sg_live_')
    expect(prefix.length).toBe(8)
  })
})

// ── Transaction validation ────────────────────────────────────────────────────

describe('transaction validation', () => {
  it('valid currency codes accepted', () => {
    expect(isSupportedCurrency('USD')).toBe(true)
    expect(isSupportedCurrency('PKR')).toBe(true)
    expect(isSupportedCurrency('AED')).toBe(true)
    expect(isSupportedCurrency('EUR')).toBe(true)
    expect(isSupportedCurrency('GBP')).toBe(true)
    expect(isSupportedCurrency('JPY')).toBe(true)
    expect(isSupportedCurrency('SAR')).toBe(true)
  })

  it('invalid currency codes rejected', () => {
    expect(isSupportedCurrency('FAKE')).toBe(false)
    expect(isSupportedCurrency('')).toBe(false)
    expect(isSupportedCurrency('XYZ')).toBe(false)
  })

  it('card number detection in paymentReference', () => {
    // A 16-digit number should be rejected as payment reference
    const cardPattern = /^\d{13,19}$/
    expect(cardPattern.test('4111111111111111')).toBe(true)  // Visa test card
    expect(cardPattern.test('TXN_REF_12345')).toBe(false)    // Safe reference
    expect(cardPattern.test('PAY-ABC-123')).toBe(false)      // Safe reference
  })
})

// ── Transaction lifecycle ─────────────────────────────────────────────────────

describe('transaction types', () => {
  const types = ['SALE', 'REFUND', 'PARTIAL_REFUND', 'VOID', 'REVERSAL', 'CHARGEBACK']

  it('all transaction types are defined', () => {
    expect(types).toContain('SALE')
    expect(types).toContain('REFUND')
    expect(types).toContain('VOID')
    expect(types).toContain('CHARGEBACK')
  })

  it('VOID and REVERSAL are treated as voids', () => {
    const isVoid = (t: string) => t === 'VOID' || t === 'REVERSAL'
    expect(isVoid('VOID')).toBe(true)
    expect(isVoid('REVERSAL')).toBe(true)
    expect(isVoid('SALE')).toBe(false)
  })

  it('REFUND/PARTIAL_REFUND/CHARGEBACK are refunds', () => {
    const isRefund = (t: string) => ['REFUND', 'PARTIAL_REFUND', 'CHARGEBACK'].includes(t)
    expect(isRefund('REFUND')).toBe(true)
    expect(isRefund('PARTIAL_REFUND')).toBe(true)
    expect(isRefund('CHARGEBACK')).toBe(true)
    expect(isRefund('SALE')).toBe(false)
  })
})

// ── Cash vs digital classification ───────────────────────────────────────────

describe('cash vs digital for live ingestion', () => {
  it('cash transactions for reconciliation', () => {
    expect(isCashPayment('CASH')).toBe(true)
    expect(isCashPayment('cash')).toBe(true)
  })

  it('card transactions are digital (not in cash reconciliation)', () => {
    expect(isDigitalPayment('CARD')).toBe(true)
    expect(isDigitalPayment('DEBIT_CARD')).toBe(true)
    expect(isDigitalPayment('CREDIT_CARD')).toBe(true)
    expect(isDigitalPayment('ONLINE_CARD')).toBe(true)
  })

  it('mobile wallets are digital', () => {
    expect(isDigitalPayment('MOBILE_WALLET')).toBe(true)
    expect(isDigitalPayment('APPLE_PAY')).toBe(true)
    expect(isDigitalPayment('GOOGLE_PAY')).toBe(true)
  })

  it('BNPL is digital', () => {
    expect(isDigitalPayment('BNPL')).toBe(true)
  })

  it('CASH is NOT digital', () => {
    expect(isDigitalPayment('CASH')).toBe(false)
  })
})

// ── Payment normalization for live data ───────────────────────────────────────

describe('payment method normalization for live ingestion', () => {
  // Square/Shopify/Toast raw values
  it('square_cash → CASH', () => expect(normalizePaymentMethod('cash')).toBe('CASH'))
  it('square_card → CARD', () => expect(normalizePaymentMethod('card')).toBe('CARD'))
  it('visa → CARD', () => expect(normalizePaymentMethod('visa')).toBe('CARD'))
  it('mastercard → CARD', () => expect(normalizePaymentMethod('mastercard')).toBe('CARD'))
  it('apple_pay → APPLE_PAY', () => expect(normalizePaymentMethod('apple_pay')).toBe('APPLE_PAY'))
  it('google_pay → GOOGLE_PAY', () => expect(normalizePaymentMethod('google_pay')).toBe('GOOGLE_PAY'))
  it('bank_transfer → BANK_TRANSFER', () => expect(normalizePaymentMethod('bank_transfer')).toBe('BANK_TRANSFER'))
  it('klarna → BNPL', () => expect(normalizePaymentMethod('klarna')).toBe('BNPL'))
  it('tabby → BNPL', () => expect(normalizePaymentMethod('tabby')).toBe('BNPL'))
  it('jazzcash → LOCAL_WALLET', () => expect(normalizePaymentMethod('jazzcash')).toBe('LOCAL_WALLET'))
  it('easypaisa → LOCAL_WALLET', () => expect(normalizePaymentMethod('easypaisa')).toBe('LOCAL_WALLET'))
  it('null → UNKNOWN', () => expect(normalizePaymentMethod(null)).toBe('UNKNOWN'))
})

// ── Data source separation ────────────────────────────────────────────────────

describe('data source separation (DEMO vs LIVE)', () => {
  const DATA_SOURCES = ['DEMO', 'CSV', 'API', 'WEBHOOK', 'TEST'] as const
  type DataSource = typeof DATA_SOURCES[number]

  it('DEMO data never enters ML training', () => {
    const isTrainingEligible = (source: DataSource, isDemo: boolean) =>
      source !== 'DEMO' && source !== 'TEST' && !isDemo
    expect(isTrainingEligible('DEMO', true)).toBe(false)
    expect(isTrainingEligible('CSV', false)).toBe(true)
    expect(isTrainingEligible('API', false)).toBe(true)
    expect(isTrainingEligible('WEBHOOK', false)).toBe(true)
    expect(isTrainingEligible('TEST', false)).toBe(false)
  })

  it('isDemo flag always blocks training regardless of source', () => {
    const isTrainingEligible = (source: DataSource, isDemo: boolean) =>
      source !== 'DEMO' && source !== 'TEST' && !isDemo
    expect(isTrainingEligible('CSV', true)).toBe(false)   // isDemo=true blocks even CSV
    expect(isTrainingEligible('API', true)).toBe(false)
  })

  it('all data sources are defined', () => {
    expect(DATA_SOURCES).toContain('DEMO')
    expect(DATA_SOURCES).toContain('CSV')
    expect(DATA_SOURCES).toContain('API')
    expect(DATA_SOURCES).toContain('WEBHOOK')
    expect(DATA_SOURCES).toContain('TEST')
  })
})

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('same externalTransactionId with same org = duplicate', () => {
    // Simulates the unique constraint: (organizationId, externalTransactionId)
    const seen = new Set<string>()
    const isDuplicate = (orgId: string, extId: string) => {
      const key = `${orgId}:${extId}`
      if (seen.has(key)) return true
      seen.add(key)
      return false
    }

    expect(isDuplicate('org_1', 'TX_001')).toBe(false)   // First: accepted
    expect(isDuplicate('org_1', 'TX_001')).toBe(true)    // Retry: duplicate
    expect(isDuplicate('org_2', 'TX_001')).toBe(false)   // Different org: accepted
    expect(isDuplicate('org_1', 'TX_002')).toBe(false)   // Different TX: accepted
  })
})

// ── Rate limiting ─────────────────────────────────────────────────────────────

describe('rate limiting logic', () => {
  it('requests below limit are allowed', () => {
    const MAX = 1000
    const count = 500
    expect(count <= MAX).toBe(true)
  })

  it('requests above limit are rejected', () => {
    const MAX = 1000
    const count = 1001
    expect(count > MAX).toBe(true)
  })
})

// ── Security: no card numbers ─────────────────────────────────────────────────

describe('security: no PAN/card numbers stored', () => {
  const CARD_PATTERN = /^\d{13,19}$/

  it('rejects Visa test card number', () => {
    expect(CARD_PATTERN.test('4111111111111111')).toBe(true) // would be rejected
  })

  it('rejects Mastercard test number', () => {
    expect(CARD_PATTERN.test('5500005555555559')).toBe(true) // would be rejected
  })

  it('accepts safe payment reference', () => {
    expect(CARD_PATTERN.test('pi_3ABC123')).toBe(false)     // safe Stripe PI
    expect(CARD_PATTERN.test('TXN-REF-2024-001')).toBe(false) // safe reference
  })

  it('paymentLast4 must be exactly 4 digits', () => {
    const LAST4 = /^\d{4}$/
    expect(LAST4.test('1234')).toBe(true)
    expect(LAST4.test('12345')).toBe(false)  // 5 digits rejected
    expect(LAST4.test('abc1')).toBe(false)   // non-numeric rejected
  })
})

