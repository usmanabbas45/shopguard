/**
 * ShopGuard Normalized Payment Methods
 *
 * Retail POS systems use many different payment method labels.
 * This module normalizes them into a canonical set while preserving
 * the raw provider-specific value for audit purposes.
 *
 * IMPORTANT: This classification drives cash reconciliation logic.
 * Only CASH is physically countable. All digital methods are excluded
 * from cash drawer expected/variance calculations.
 */

// ── Canonical payment method enum ───────────────────────────────────────────

export const PAYMENT_METHODS = [
  'CASH',
  'CARD',              // Generic card (unknown type)
  'CREDIT_CARD',
  'DEBIT_CARD',
  'CONTACTLESS',       // Tap-to-pay (may be card or wallet)
  'ONLINE_CARD',       // Card-not-present / ecommerce
  'BANK_TRANSFER',
  'MOBILE_WALLET',     // Generic mobile wallet
  'DIGITAL_WALLET',    // Generic digital wallet
  'PAYPAL',
  'APPLE_PAY',
  'GOOGLE_PAY',
  'SAMSUNG_PAY',
  'ALIPAY',
  'WECHAT_PAY',
  'LOCAL_WALLET',      // Region-specific wallets (JazzCash, Easypaisa, GoPay, etc.)
  'GIFT_CARD',
  'STORE_CREDIT',
  'VOUCHER',
  'BNPL',              // Buy Now Pay Later (Klarna, Afterpay, etc.)
  'CRYPTO',
  'CHECK',
  'OTHER',
  'UNKNOWN',
] as const

export type PaymentMethod = typeof PAYMENT_METHODS[number]

/**
 * Determine if a payment method is physically countable cash.
 * Only CASH transactions contribute to cash drawer expected totals.
 */
export function isCashPayment(method: string | null | undefined): boolean {
  return (method ?? '').toUpperCase() === 'CASH'
}

/**
 * Determine if a payment method is digital (non-cash).
 * Digital payments are NOT included in cash reconciliation.
 */
export function isDigitalPayment(method: string | null | undefined): boolean {
  const m = (method ?? '').toUpperCase()
  return m !== 'CASH' && m !== 'UNKNOWN' && m !== ''
}

/**
 * Normalize a raw provider payment method string to the canonical enum.
 *
 * @param raw       Raw string from POS/CSV (e.g. "Visa Debit", "JazzCash", "Tap")
 * @returns         Canonical PaymentMethod value
 */
export function normalizePaymentMethod(raw: string | null | undefined): PaymentMethod {
  if (!raw) return 'UNKNOWN'
  const v = raw.toLowerCase().trim()

  // Cash
  if (['cash', 'cash payment', 'currency', 'notes', 'coins', 'physical cash'].includes(v))
    return 'CASH'

  // Specific digital wallets
  if (['apple pay', 'applepay', 'apple_pay'].includes(v)) return 'APPLE_PAY'
  if (['google pay', 'googlepay', 'g pay', 'google_pay'].includes(v)) return 'GOOGLE_PAY'
  if (['samsung pay', 'samsungpay'].includes(v)) return 'SAMSUNG_PAY'
  if (['paypal'].includes(v)) return 'PAYPAL'
  if (['alipay', 'ali pay'].includes(v)) return 'ALIPAY'
  if (['wechat pay', 'wechatpay', 'wechat'].includes(v)) return 'WECHAT_PAY'

  // Local/regional wallets (not exhaustive — add as needed)
  if (['jazzcash', 'easypaisa', 'sadapay', 'nayapay',   // Pakistan
       'bkash', 'nagad', 'rocket',                        // Bangladesh
       'gopay', 'ovo', 'dana', 'linkaja',                 // Indonesia
       'promptpay',                                        // Thailand
       'gcash', 'paymaya',                                // Philippines
       'touch n go', 'touchngo', 'boost',                 // Malaysia
       'paytm', 'phonepe', 'upi',                         // India
       'stcpay', 'stc pay',                               // Saudi Arabia
  ].some(k => v.includes(k))) return 'LOCAL_WALLET'

  // BNPL
  if (['klarna', 'afterpay', 'laybuy', 'zip', 'sezzle',
       'affirm', 'splitit', 'tabby', 'tamara', 'postpay',
       'buy now pay later', 'bnpl'].some(k => v.includes(k))) return 'BNPL'

  // Gift card / store credit / voucher
  if (['gift card', 'giftcard', 'gift voucher'].some(k => v.includes(k))) return 'GIFT_CARD'
  if (['store credit', 'loyalty credit', 'account credit'].some(k => v.includes(k))) return 'STORE_CREDIT'
  if (['voucher', 'coupon'].some(k => v.includes(k))) return 'VOUCHER'

  // Crypto — use word-boundary matching for short tokens to avoid false positives
  // e.g. 'method' contains 'eth' but is not crypto
  if (['crypto', 'bitcoin', 'ethereum', 'stablecoin'].some(k => v.includes(k))) return 'CRYPTO'
  if (/(^|[^a-z])(btc|eth|usdt|sol|xrp)([^a-z]|$)/.test(v)) return 'CRYPTO'

  // Check / cheque
  if (['check', 'cheque', 'personal check'].some(k => v.includes(k))) return 'CHECK'

  // Bank transfer
  if (['bank transfer', 'bank_transfer', 'wire transfer', 'ach', 'eft', 'direct debit',
       'bank payment', 'online banking'].some(k => v.includes(k))) return 'BANK_TRANSFER'

  // Contactless (generic tap-to-pay, before card check)
  if (['contactless', 'tap', 'tap to pay', 'nfc'].some(k => v.includes(k))) return 'CONTACTLESS'

  // Online card (card-not-present)
  if (['online card', 'card online', 'ecommerce', 'e-commerce',
       'card not present', 'cnp', 'online'].some(k => k === v)) return 'ONLINE_CARD'  // exact 'online'

  // Digital wallet (generic)
  if (['digital wallet', 'ewallet', 'e-wallet', 'mobile payment',
       'pay later'].some(k => v.includes(k))) return 'DIGITAL_WALLET'

  // Mobile wallet (generic)
  if (['mobile wallet', 'mobile money'].some(k => v.includes(k))) return 'MOBILE_WALLET'

  // Specific card types
  if (['credit card', 'credit', 'amex', 'american express', 'diners'].some(k => v.includes(k))) return 'CREDIT_CARD'
  if (['debit card', 'debit'].some(k => v.includes(k))) return 'DEBIT_CARD'

  // Generic card (visa/mastercard without type specified)
  if (['card', 'visa', 'mastercard', 'eftpos', 'chip', 'swipe'].some(k => v.includes(k))) return 'CARD'

  return 'OTHER'
}

/**
 * Payment method display labels for the UI.
 * Do not use these for business logic — use the canonical code.
 */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  CREDIT_CARD: 'Credit Card',
  DEBIT_CARD: 'Debit Card',
  CONTACTLESS: 'Contactless',
  ONLINE_CARD: 'Online Card',
  BANK_TRANSFER: 'Bank Transfer',
  MOBILE_WALLET: 'Mobile Wallet',
  DIGITAL_WALLET: 'Digital Wallet',
  PAYPAL: 'PayPal',
  APPLE_PAY: 'Apple Pay',
  GOOGLE_PAY: 'Google Pay',
  SAMSUNG_PAY: 'Samsung Pay',
  ALIPAY: 'Alipay',
  WECHAT_PAY: 'WeChat Pay',
  LOCAL_WALLET: 'Local Wallet',
  GIFT_CARD: 'Gift Card',
  STORE_CREDIT: 'Store Credit',
  VOUCHER: 'Voucher',
  BNPL: 'Buy Now Pay Later',
  CRYPTO: 'Cryptocurrency',
  CHECK: 'Check',
  OTHER: 'Other',
  UNKNOWN: 'Unknown',
}

/**
 * Payment channels — where the transaction originated.
 */
export const PAYMENT_CHANNELS = [
  'IN_STORE',
  'ONLINE',
  'MOBILE_APP',
  'PHONE',
  'KIOSK',
  'THIRD_PARTY',
  'UNKNOWN',
] as const
export type PaymentChannel = typeof PAYMENT_CHANNELS[number]

/**
 * Normalized payment status — maps provider-specific statuses to a canonical set.
 */
export const PAYMENT_STATUSES = [
  'PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'PAID',
  'FAILED',
  'DECLINED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'VOIDED',
  'REVERSED',
  'CHARGEBACK',
  'DISPUTED',
] as const
export type PaymentStatus = typeof PAYMENT_STATUSES[number]

