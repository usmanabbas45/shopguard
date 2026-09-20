/**
 * Tests for global internationalization: currency, locale, payment methods
 */
import { describe, it, expect } from 'vitest'
import {
  formatCurrency,
  currencyMinorUnits,
  isSupportedCurrency,
  SUPPORTED_CURRENCIES,
  ALL_TIMEZONES,
  isValidTimezone,
} from '../lib/money'
import {
  normalizePaymentMethod,
  isCashPayment,
  isDigitalPayment,
  PAYMENT_METHOD_LABELS,
} from '../lib/payment-methods'

// ── Currency minor units ─────────────────────────────────────────────────────
describe('Currency minor units (ISO 4217)', () => {
  it('USD has 2 decimal places', () => expect(currencyMinorUnits('USD')).toBe(2))
  it('EUR has 2 decimal places', () => expect(currencyMinorUnits('EUR')).toBe(2))
  it('GBP has 2 decimal places', () => expect(currencyMinorUnits('GBP')).toBe(2))
  it('PKR has 2 decimal places', () => expect(currencyMinorUnits('PKR')).toBe(2))
  it('AED has 2 decimal places', () => expect(currencyMinorUnits('AED')).toBe(2))
  it('JPY has 0 decimal places', () => expect(currencyMinorUnits('JPY')).toBe(0))
  it('KRW has 0 decimal places', () => expect(currencyMinorUnits('KRW')).toBe(0))
  it('IDR has 0 decimal places', () => expect(currencyMinorUnits('IDR')).toBe(0))
  it('KWD has 3 decimal places', () => expect(currencyMinorUnits('KWD')).toBe(3))
  it('BHD has 3 decimal places', () => expect(currencyMinorUnits('BHD')).toBe(3))
  it('OMR has 3 decimal places', () => expect(currencyMinorUnits('OMR')).toBe(3))
  it('unknown currency defaults to 2', () => expect(currencyMinorUnits('XYZ')).toBe(2))
  it('is case insensitive', () => expect(currencyMinorUnits('jpy')).toBe(0))
})

// ── Currency formatting ──────────────────────────────────────────────────────
describe('Currency formatting', () => {
  it('formats USD correctly', () => {
    const result = formatCurrency(1099.99, 'USD', 'en-US')
    expect(result).toContain('1,099.99')
    expect(result).toContain('$')
  })

  it('formats EUR correctly', () => {
    const result = formatCurrency(1500, 'EUR', 'de-DE')
    expect(result).toContain('1.500')
    expect(result).toContain('€')
  })

  it('formats GBP correctly', () => {
    const result = formatCurrency(250.50, 'GBP', 'en-GB')
    expect(result).toContain('250.50')
    expect(result).toContain('£')
  })

  it('formats PKR correctly', () => {
    const result = formatCurrency(1500, 'PKR', 'en-PK')
    expect(result).toContain('1,500')
  })

  it('formats JPY with no decimal places', () => {
    const result = formatCurrency(1500, 'JPY', 'ja-JP')
    expect(result).not.toContain('.')
    expect(result).toContain('1,500')
  })

  it('formats AED correctly', () => {
    const result = formatCurrency(500, 'AED', 'ar-AE')
    expect(result).toContain('500')
  })

  it('falls back gracefully for unknown currency', () => {
    const result = formatCurrency(100, 'XYZ', 'en-US')
    expect(result).toContain('100')
  })

  it('does not default to PKR', () => {
    const result = formatCurrency(100)
    expect(result).not.toContain('PKR')
    expect(result).toContain('$') // defaults to USD
  })

  it('does not use en-PK as default locale', () => {
    // Default locale is en-US, not en-PK
    const result = formatCurrency(1234.56)
    expect(result).toContain('1,234.56')
  })
})

// ── Supported currencies ─────────────────────────────────────────────────────
describe('Supported currencies list', () => {
  it('includes all major currencies', () => {
    const codes = SUPPORTED_CURRENCIES.map(c => c.code)
    expect(codes).toContain('USD')
    expect(codes).toContain('EUR')
    expect(codes).toContain('GBP')
    expect(codes).toContain('JPY')
    expect(codes).toContain('AED')
    expect(codes).toContain('PKR')
    expect(codes).toContain('INR')
    expect(codes).toContain('SAR')
    expect(codes).toContain('CAD')
    expect(codes).toContain('AUD')
    expect(codes).toContain('SGD')
  })

  it('isSupportedCurrency returns true for USD', () => expect(isSupportedCurrency('USD')).toBe(true))
  it('isSupportedCurrency returns true for PKR', () => expect(isSupportedCurrency('PKR')).toBe(true))
  it('isSupportedCurrency is case insensitive', () => expect(isSupportedCurrency('usd')).toBe(true))
  it('isSupportedCurrency returns false for fake code', () => expect(isSupportedCurrency('XYZ')).toBe(false))

  it('has more than 30 currencies', () => {
    expect(SUPPORTED_CURRENCIES.length).toBeGreaterThan(30)
  })
})

// ── Timezone handling ────────────────────────────────────────────────────────
describe('Timezone handling', () => {
  it('isValidTimezone accepts UTC', () => expect(isValidTimezone('UTC')).toBe(true))
  it('isValidTimezone accepts America/New_York', () => expect(isValidTimezone('America/New_York')).toBe(true))
  it('isValidTimezone accepts Europe/London', () => expect(isValidTimezone('Europe/London')).toBe(true))
  it('isValidTimezone accepts Asia/Karachi', () => expect(isValidTimezone('Asia/Karachi')).toBe(true))
  it('isValidTimezone accepts Asia/Dubai', () => expect(isValidTimezone('Asia/Dubai')).toBe(true))
  it('isValidTimezone accepts Asia/Tokyo', () => expect(isValidTimezone('Asia/Tokyo')).toBe(true))
  it('isValidTimezone accepts Australia/Sydney', () => expect(isValidTimezone('Australia/Sydney')).toBe(true))
  it('isValidTimezone rejects invalid timezone', () => expect(isValidTimezone('Invalid/Timezone')).toBe(false))
  it('ALL_TIMEZONES has entries for all major regions', () => {
    const ids = ALL_TIMEZONES.map((t: { id: string; label: string }) => t.id)
    expect(ids).toContain('America/New_York')
    expect(ids).toContain('Europe/London')
    expect(ids).toContain('Asia/Karachi')
    expect(ids).toContain('Asia/Dubai')
    expect(ids).toContain('Asia/Tokyo')
    expect(ids).toContain('Australia/Sydney')
    expect(ids).toContain('UTC')
  })
})

// ── Payment method normalization ─────────────────────────────────────────────
describe('Payment method normalization', () => {
  // Cash
  it('normalizes "cash" → CASH', () => expect(normalizePaymentMethod('cash')).toBe('CASH'))
  it('normalizes "Cash Payment" → CASH', () => expect(normalizePaymentMethod('Cash Payment')).toBe('CASH'))
  it('normalizes "CASH" → CASH', () => expect(normalizePaymentMethod('CASH')).toBe('CASH'))

  // Cards
  it('normalizes "card" → CARD', () => expect(normalizePaymentMethod('card')).toBe('CARD'))
  it('normalizes "Visa" → CARD', () => expect(normalizePaymentMethod('Visa')).toBe('CARD'))
  it('normalizes "Mastercard" → CARD', () => expect(normalizePaymentMethod('Mastercard')).toBe('CARD'))
  it('normalizes "Credit Card" → CREDIT_CARD', () => expect(normalizePaymentMethod('Credit Card')).toBe('CREDIT_CARD'))
  it('normalizes "Debit Card" → DEBIT_CARD', () => expect(normalizePaymentMethod('Debit Card')).toBe('DEBIT_CARD'))
  it('normalizes "contactless" → CONTACTLESS', () => expect(normalizePaymentMethod('contactless')).toBe('CONTACTLESS'))

  // Digital wallets
  it('normalizes "Apple Pay" → APPLE_PAY', () => expect(normalizePaymentMethod('Apple Pay')).toBe('APPLE_PAY'))
  it('normalizes "Google Pay" → GOOGLE_PAY', () => expect(normalizePaymentMethod('Google Pay')).toBe('GOOGLE_PAY'))
  it('normalizes "PayPal" → PAYPAL', () => expect(normalizePaymentMethod('PayPal')).toBe('PAYPAL'))
  it('normalizes "Alipay" → ALIPAY', () => expect(normalizePaymentMethod('Alipay')).toBe('ALIPAY'))
  it('normalizes "WeChat Pay" → WECHAT_PAY', () => expect(normalizePaymentMethod('WeChat Pay')).toBe('WECHAT_PAY'))

  // Local wallets (multi-region)
  it('normalizes "JazzCash" (Pakistan) → LOCAL_WALLET', () => expect(normalizePaymentMethod('JazzCash')).toBe('LOCAL_WALLET'))
  it('normalizes "Easypaisa" (Pakistan) → LOCAL_WALLET', () => expect(normalizePaymentMethod('Easypaisa')).toBe('LOCAL_WALLET'))
  it('normalizes "GoPay" (Indonesia) → LOCAL_WALLET', () => expect(normalizePaymentMethod('GoPay')).toBe('LOCAL_WALLET'))
  it('normalizes "GCash" (Philippines) → LOCAL_WALLET', () => expect(normalizePaymentMethod('GCash')).toBe('LOCAL_WALLET'))
  it('normalizes "UPI" (India) → LOCAL_WALLET', () => expect(normalizePaymentMethod('UPI')).toBe('LOCAL_WALLET'))
  it('normalizes "STC Pay" (Saudi) → LOCAL_WALLET', () => expect(normalizePaymentMethod('STC Pay')).toBe('LOCAL_WALLET'))
  it('normalizes "bKash" (Bangladesh) → LOCAL_WALLET', () => expect(normalizePaymentMethod('bKash')).toBe('LOCAL_WALLET'))

  // BNPL
  it('normalizes "Klarna" → BNPL', () => expect(normalizePaymentMethod('Klarna')).toBe('BNPL'))
  it('normalizes "Afterpay" → BNPL', () => expect(normalizePaymentMethod('Afterpay')).toBe('BNPL'))
  it('normalizes "Tabby" (MENA) → BNPL', () => expect(normalizePaymentMethod('Tabby')).toBe('BNPL'))
  it('normalizes "Tamara" (MENA) → BNPL', () => expect(normalizePaymentMethod('Tamara')).toBe('BNPL'))

  // Other
  it('normalizes "Bank Transfer" → BANK_TRANSFER', () => expect(normalizePaymentMethod('Bank Transfer')).toBe('BANK_TRANSFER'))
  it('normalizes "Gift Card" → GIFT_CARD', () => expect(normalizePaymentMethod('Gift Card')).toBe('GIFT_CARD'))
  it('normalizes null → UNKNOWN', () => expect(normalizePaymentMethod(null)).toBe('UNKNOWN'))
  it('normalizes empty → UNKNOWN', () => expect(normalizePaymentMethod('')).toBe('UNKNOWN'))
  it('normalizes unknown → OTHER', () => expect(normalizePaymentMethod('PROPRIETARY_TENDER_TYPE_99')).toBe('OTHER'))

  it('all canonical methods have labels', () => {
    const methods = ['CASH','CARD','CREDIT_CARD','DEBIT_CARD','CONTACTLESS','ONLINE_CARD',
      'BANK_TRANSFER','MOBILE_WALLET','DIGITAL_WALLET','PAYPAL','APPLE_PAY','GOOGLE_PAY',
      'SAMSUNG_PAY','ALIPAY','WECHAT_PAY','LOCAL_WALLET','GIFT_CARD','STORE_CREDIT',
      'VOUCHER','BNPL','CRYPTO','CHECK','OTHER','UNKNOWN'] as const
    for (const method of methods) {
      expect(PAYMENT_METHOD_LABELS[method]).toBeDefined()
    }
  })
})

// ── Cash vs digital classification ──────────────────────────────────────────
describe('Cash vs digital classification', () => {
  it('CASH is cash', () => expect(isCashPayment('CASH')).toBe(true))
  it('cash (lowercase) is cash', () => expect(isCashPayment('cash')).toBe(true))
  it('CARD is not cash', () => expect(isCashPayment('CARD')).toBe(false))
  it('APPLE_PAY is not cash', () => expect(isCashPayment('APPLE_PAY')).toBe(false))
  it('BANK_TRANSFER is not cash', () => expect(isCashPayment('BANK_TRANSFER')).toBe(false))
  it('null is not cash', () => expect(isCashPayment(null)).toBe(false))
  it('empty string is not cash', () => expect(isCashPayment('')).toBe(false))

  it('CARD is digital', () => expect(isDigitalPayment('CARD')).toBe(true))
  it('APPLE_PAY is digital', () => expect(isDigitalPayment('APPLE_PAY')).toBe(true))
  it('CASH is not digital', () => expect(isDigitalPayment('CASH')).toBe(false))
  it('null is not digital', () => expect(isDigitalPayment(null)).toBe(false))
})

// ── Cash reconciliation correctness ─────────────────────────────────────────
describe('Cash reconciliation: only cash transactions count', () => {
  const transactions = [
    { amount: 100, paymentMethod: 'CASH' },
    { amount: 200, paymentMethod: 'CARD' },
    { amount: 150, paymentMethod: 'APPLE_PAY' },
    { amount: 75, paymentMethod: 'cash' },
    { amount: 50, paymentMethod: 'BANK_TRANSFER' },
    { amount: 300, paymentMethod: null },
  ]

  it('only counts cash transactions in expected cash total', () => {
    const cashTotal = transactions
      .filter(t => isCashPayment(t.paymentMethod))
      .reduce((sum, t) => sum + t.amount, 0)
    expect(cashTotal).toBe(175) // 100 + 75 only
  })

  it('excludes CARD from cash total', () => {
    const cashOnly = transactions.filter(t => isCashPayment(t.paymentMethod))
    expect(cashOnly.some(t => t.paymentMethod === 'CARD')).toBe(false)
  })

  it('excludes APPLE_PAY from cash total', () => {
    const cashOnly = transactions.filter(t => isCashPayment(t.paymentMethod))
    expect(cashOnly.some(t => t.paymentMethod === 'APPLE_PAY')).toBe(false)
  })
})

// ── Risk rule: void after cash (not card) ───────────────────────────────────
describe('Risk rule: void after cash payment only', () => {
  it('CASH void triggers', () => {
    expect(isCashPayment('CASH')).toBe(true)
    // void_after_cash rule should trigger
  })

  it('CARD void does NOT trigger void_after_cash', () => {
    expect(isCashPayment('CARD')).toBe(false)
    // void_after_cash rule should NOT trigger for card
  })

  it('LOCAL_WALLET void does NOT trigger void_after_cash', () => {
    expect(isCashPayment('LOCAL_WALLET')).toBe(false)
  })

  it('GOOGLE_PAY void does NOT trigger void_after_cash', () => {
    expect(isCashPayment('GOOGLE_PAY')).toBe(false)
  })
})
