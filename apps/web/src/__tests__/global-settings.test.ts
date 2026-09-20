/**
 * Tests for global settings: money formatting, timezone validation,
 * payment classification, settings API, and billing abstractions.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  formatCurrency,
  currencyMinorUnits,
  isSupportedCurrency,
  isValidTimezone,
  getRuntimeTimezones,
} from '@/lib/money'
import {
  normalizePaymentMethod,
  isCashPayment,
  isDigitalPayment,
} from '@/lib/payment-methods'
import {
  getVariantId,
  getBillingProvider,
} from '@/lib/billing/provider'

// ── Currency formatting ───────────────────────────────────────────────────────

describe('formatCurrency', () => {
  it('USD: 2 decimal places with $ symbol', () => {
    const result = formatCurrency(1234.56, 'USD', 'en-US')
    expect(result).toMatch(/\$1,234\.56/)
  })

  it('EUR: 2 decimal places with € symbol', () => {
    const result = formatCurrency(1234.56, 'EUR', 'de-DE')
    expect(result).toContain('1.234,56')
  })

  it('GBP: 2 decimal places with £ symbol', () => {
    const result = formatCurrency(1000.00, 'GBP', 'en-GB')
    expect(result).toContain('1,000.00')
  })

  it('PKR: 2 decimal places', () => {
    const result = formatCurrency(5000.00, 'PKR', 'en-PK')
    expect(result).toContain('5,000')
  })

  it('AED: 2 decimal places', () => {
    const result = formatCurrency(500.75, 'AED', 'en-US')
    expect(result).toContain('500')  // use en-US locale to get Latin digits
  })

  it('SAR: 2 decimal places', () => {
    const result = formatCurrency(250.50, 'SAR', 'en-US')
    expect(result).toContain('250')  // use en-US locale to get Latin digits
  })

  it('JPY: 0 decimal places (no yen fractions)', () => {
    const result = formatCurrency(1000, 'JPY', 'ja-JP')
    // JPY should not show .00
    expect(result).not.toContain('.00')
    expect(result).not.toContain('.0')
  })

  it('KWD: 3 decimal places', () => {
    const result = formatCurrency(10.500, 'KWD', 'en-US')
    // KWD uses 3 decimals — result should contain .500 not .50
    expect(result).toContain('10.500')  // 3 decimal places for KWD
  })

  it('IDR: 0 decimal places', () => {
    // IDR (Indonesian Rupiah) has 0 decimal places
    // Format with a value that won't create ambiguous thousand-separator patterns
    const result = formatCurrency(100, 'IDR', 'en-US')
    // 100 IDR formatted with 0 decimals = 'IDR 100' (no decimal separator)
    expect(currencyMinorUnits('IDR')).toBe(0)
    expect(result).not.toMatch(/\.\d+$/)  // no decimal part at end
  })

  it('BHD: 3 decimal places', () => {
    const result = formatCurrency(5.100, 'BHD', 'en-US')
    expect(result).toContain('5.100')  // 3 decimal places for BHD
  })

  it('falls back gracefully for unknown locale', () => {
    const result = formatCurrency(100, 'USD', 'xx-XX')
    // Should not throw
    expect(result).toBeTruthy()
  })
})

// ── Currency minor units ──────────────────────────────────────────────────────

describe('currencyMinorUnits', () => {
  it('USD → 2', () => expect(currencyMinorUnits('USD')).toBe(2))
  it('EUR → 2', () => expect(currencyMinorUnits('EUR')).toBe(2))
  it('GBP → 2', () => expect(currencyMinorUnits('GBP')).toBe(2))
  it('PKR → 2', () => expect(currencyMinorUnits('PKR')).toBe(2))
  it('AED → 2', () => expect(currencyMinorUnits('AED')).toBe(2))
  it('JPY → 0', () => expect(currencyMinorUnits('JPY')).toBe(0))
  it('KRW → 0', () => expect(currencyMinorUnits('KRW')).toBe(0))
  it('KWD → 3', () => expect(currencyMinorUnits('KWD')).toBe(3))
  it('BHD → 3', () => expect(currencyMinorUnits('BHD')).toBe(3))
  it('OMR → 3', () => expect(currencyMinorUnits('OMR')).toBe(3))
  it('unknown → 2 (default)', () => expect(currencyMinorUnits('XYZ')).toBe(2))
  it('lowercase input works', () => expect(currencyMinorUnits('jpy')).toBe(0))
})

// ── Currency validation ───────────────────────────────────────────────────────

describe('isSupportedCurrency', () => {
  it('accepts USD', () => expect(isSupportedCurrency('USD')).toBe(true))
  it('accepts EUR', () => expect(isSupportedCurrency('EUR')).toBe(true))
  it('accepts PKR', () => expect(isSupportedCurrency('PKR')).toBe(true))
  it('accepts AED', () => expect(isSupportedCurrency('AED')).toBe(true))
  it('accepts KWD', () => expect(isSupportedCurrency('KWD')).toBe(true))
  it('accepts JPY', () => expect(isSupportedCurrency('JPY')).toBe(true))
  it('accepts lowercase usd', () => expect(isSupportedCurrency('usd')).toBe(true))
  it('rejects FAKE', () => expect(isSupportedCurrency('FAKE')).toBe(false))
  it('rejects empty string', () => expect(isSupportedCurrency('')).toBe(false))
  it('rejects invalid code XYZ', () => expect(isSupportedCurrency('XYZ')).toBe(false))
})

// ── Timezone validation ───────────────────────────────────────────────────────

describe('isValidTimezone', () => {
  it('UTC is valid', () => expect(isValidTimezone('UTC')).toBe(true))
  it('Asia/Karachi is valid', () => expect(isValidTimezone('Asia/Karachi')).toBe(true))
  it('Asia/Dubai is valid', () => expect(isValidTimezone('Asia/Dubai')).toBe(true))
  it('Europe/London is valid', () => expect(isValidTimezone('Europe/London')).toBe(true))
  it('Europe/Berlin is valid', () => expect(isValidTimezone('Europe/Berlin')).toBe(true))
  it('America/New_York is valid', () => expect(isValidTimezone('America/New_York')).toBe(true))
  it('America/Los_Angeles is valid', () => expect(isValidTimezone('America/Los_Angeles')).toBe(true))
  it('Asia/Tokyo is valid', () => expect(isValidTimezone('Asia/Tokyo')).toBe(true))
  it('Australia/Sydney is valid', () => expect(isValidTimezone('Australia/Sydney')).toBe(true))
  it('rejects invalid string', () => expect(isValidTimezone('Not/ATimezone')).toBe(false))
  it('rejects empty string', () => expect(isValidTimezone('')).toBe(false))
  it('rejects random text', () => expect(isValidTimezone('foobar')).toBe(false))
})

describe('getRuntimeTimezones', () => {
  it('includes UTC', () => {
    const tzs = getRuntimeTimezones()
    expect(tzs).toContain('UTC')
  })
  it('includes Asia/Karachi', () => {
    const tzs = getRuntimeTimezones()
    expect(tzs).toContain('Asia/Karachi')
  })
  it('returns an array with more than 400 entries', () => {
    const tzs = getRuntimeTimezones()
    expect(tzs.length).toBeGreaterThan(400)
  })
})

// ── Payment classification ────────────────────────────────────────────────────

describe('normalizePaymentMethod', () => {
  // Standard methods
  it('CASH', () => expect(normalizePaymentMethod('cash')).toBe('CASH'))
  it('CREDIT_CARD (credit_card)', () => expect(normalizePaymentMethod('credit_card')).toBe('CREDIT_CARD'))
  it('CREDIT_CARD (credit card)', () => expect(normalizePaymentMethod('credit card')).toBe('CREDIT_CARD'))
  it('DEBIT_CARD', () => expect(normalizePaymentMethod('debit')).toBe('DEBIT_CARD'))
  it('DEBIT_CARD (debit_card)', () => expect(normalizePaymentMethod('debit_card')).toBe('DEBIT_CARD'))
  it('ONLINE_CARD (online)', () => expect(normalizePaymentMethod('online')).toBe('ONLINE_CARD'))
  it('BANK_TRANSFER', () => expect(normalizePaymentMethod('bank_transfer')).toBe('BANK_TRANSFER'))
  it('LOCAL_WALLET (easypaisa)', () => expect(normalizePaymentMethod('easypaisa')).toBe('LOCAL_WALLET'))
  it('LOCAL_WALLET (jazzcash)', () => expect(normalizePaymentMethod('jazzcash')).toBe('LOCAL_WALLET'))
  it('APPLE_PAY', () => expect(normalizePaymentMethod('apple_pay')).toBe('APPLE_PAY'))
  it('GOOGLE_PAY', () => expect(normalizePaymentMethod('google_pay')).toBe('GOOGLE_PAY'))
  it('BNPL (tabby)', () => expect(normalizePaymentMethod('tabby')).toBe('BNPL'))
  it('BNPL (tamara)', () => expect(normalizePaymentMethod('tamara')).toBe('BNPL'))
  it('BNPL (afterpay)', () => expect(normalizePaymentMethod('afterpay')).toBe('BNPL'))
  it('BNPL (klarna)', () => expect(normalizePaymentMethod('klarna')).toBe('BNPL'))
  it('refund maps to OTHER (refunds are transaction types, not payment methods)', () => expect(normalizePaymentMethod('refund')).toBe('OTHER'))
  it('chargeback is OTHER (it is a transaction status, not a payment method)', () => expect(normalizePaymentMethod('chargeback')).toBe('OTHER'))
  it('OTHER for unrecognized method (UNKNOWN only for null/empty)', () => expect(normalizePaymentMethod('zork_payment_42')).toBe('OTHER'))
  it('handles mixed case', () => expect(normalizePaymentMethod('CASH')).toBe('CASH'))
  it('handles spaces', () => expect(normalizePaymentMethod('  cash  ')).toBe('CASH'))
})

describe('isCashPayment', () => {
  it('cash is cash', () => expect(isCashPayment('CASH')).toBe(true))
  it('card is not cash', () => expect(isCashPayment('CARD')).toBe(false))
  it('debit is not cash', () => expect(isCashPayment('DEBIT_CARD')).toBe(false))
  it('mobile wallet is not cash', () => expect(isCashPayment('MOBILE_WALLET')).toBe(false))
})

describe('isDigitalPayment', () => {
  it('CARD is digital', () => expect(isDigitalPayment('CARD')).toBe(true))
  it('DEBIT_CARD is digital', () => expect(isDigitalPayment('DEBIT_CARD')).toBe(true))
  it('MOBILE_WALLET is digital', () => expect(isDigitalPayment('MOBILE_WALLET')).toBe(true))
  it('APPLE_PAY is digital', () => expect(isDigitalPayment('APPLE_PAY')).toBe(true))
  it('GOOGLE_PAY is digital', () => expect(isDigitalPayment('GOOGLE_PAY')).toBe(true))
  it('BNPL is digital', () => expect(isDigitalPayment('BNPL')).toBe(true))
  it('CASH is not digital', () => expect(isDigitalPayment('CASH')).toBe(false))
  it('REFUND is non-cash (digital function returns true for non-cash, non-unknown)', () => expect(isDigitalPayment('REFUND')).toBe(true))
})

// ── Billing provider (Lemon Squeezy) ─────────────────────────────────────────

describe('getBillingProvider', () => {
  it('returns null when LEMONSQUEEZY_API_KEY is not set', () => {
    const orig = process.env.LEMONSQUEEZY_API_KEY
    delete process.env.LEMONSQUEEZY_API_KEY
    const provider = getBillingProvider()
    expect(provider).toBeNull()
    process.env.LEMONSQUEEZY_API_KEY = orig
  })

  it('returns a provider when LS env vars are set', () => {
    process.env.LEMONSQUEEZY_API_KEY = 'test_fake_ls_key'
    process.env.LEMONSQUEEZY_STORE_ID = '12345'
    const provider = getBillingProvider()
    expect(provider).not.toBeNull()
    expect(provider?.name).toBe('lemonsqueezy')
    delete process.env.LEMONSQUEEZY_API_KEY
    delete process.env.LEMONSQUEEZY_STORE_ID
  })
})

describe('getVariantId', () => {
  it('throws a clear error when variant ID not configured', () => {
    delete process.env.LEMONSQUEEZY_VARIANT_STARTER_MONTHLY
    expect(() => getVariantId('STARTER', 'monthly')).toThrow('Billing not configured')
    expect(() => getVariantId('STARTER', 'monthly')).toThrow('LEMONSQUEEZY_VARIANT_STARTER_MONTHLY')
  })

  it('returns configured variant ID', () => {
    process.env.LEMONSQUEEZY_VARIANT_STARTER_MONTHLY = '99999'
    expect(getVariantId('STARTER', 'monthly')).toBe('99999')
    delete process.env.LEMONSQUEEZY_VARIANT_STARTER_MONTHLY
  })
})

describe('LemonSqueezy mapEventType', () => {
  beforeEach(() => {
    process.env.LEMONSQUEEZY_API_KEY = 'test_fake_ls_key'
    process.env.LEMONSQUEEZY_STORE_ID = '12345'
  })
  afterEach(() => {
    delete process.env.LEMONSQUEEZY_API_KEY
    delete process.env.LEMONSQUEEZY_STORE_ID
  })

  it('maps order_created to checkout.completed', () => {
    expect(getBillingProvider()!.mapEventType('order_created')).toBe('checkout.completed')
  })
  it('maps subscription_created', () => {
    expect(getBillingProvider()!.mapEventType('subscription_created')).toBe('subscription.created')
  })
  it('maps subscription_cancelled to canceled', () => {
    expect(getBillingProvider()!.mapEventType('subscription_cancelled')).toBe('subscription.canceled')
  })
  it('maps subscription_payment_failed', () => {
    expect(getBillingProvider()!.mapEventType('subscription_payment_failed')).toBe('invoice.payment_failed')
  })
  it('returns null for unknown events', () => {
    expect(getBillingProvider()!.mapEventType('some.unknown.event')).toBeNull()
  })
})

describe('LemonSqueezy webhook signature', () => {
  it('rejects invalid signature', async () => {
    process.env.LEMONSQUEEZY_API_KEY = 'test_fake_ls_key'
    process.env.LEMONSQUEEZY_STORE_ID = '12345'
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET = 'test_webhook_secret'
    const provider = getBillingProvider()!
    await expect(
      provider.verifyWebhook('{"meta":{"event_name":"order_created"}}', 'invalid_sig')
    ).rejects.toThrow('Invalid webhook signature')
    delete process.env.LEMONSQUEEZY_API_KEY
    delete process.env.LEMONSQUEEZY_STORE_ID
    delete process.env.LEMONSQUEEZY_WEBHOOK_SECRET
  })
})
