/**
 * ShopGuard Global Money & Locale Utilities
 *
 * Currency is stored as numeric(18,2) in the database (legacy).
 * Formatting uses Intl.NumberFormat with the organization's locale.
 *
 * ISO 4217 minor units reference (partial — the common ones):
 *   2 decimals: USD, EUR, GBP, PKR, AED, SAR, CAD, AUD, SGD, MYR, INR, CNY, HKD, THB
 *   0 decimals: JPY, KRW, IDR, VND, CLP, ISK, HUF, DJF, GNF, KMF, PYG, RWF, UGX, VUV, XAF, XOF, XPF
 *   3 decimals: KWD, BHD, OMR, JOD, TND, LYD
 */

// ── ISO 4217 minor unit map ──────────────────────────────────────────────────
const CURRENCY_MINOR_UNITS: Record<string, number> = {
  // 0 decimal places
  JPY: 0, KRW: 0, IDR: 0, VND: 0, CLP: 0, ISK: 0, HUF: 0,
  DJF: 0, GNF: 0, KMF: 0, PYG: 0, RWF: 0, UGX: 0, VUV: 0,
  XAF: 0, XOF: 0, XPF: 0, MGA: 0, XDR: 0,
  // 2 decimal places (default — most currencies)
  USD: 2, EUR: 2, GBP: 2, PKR: 2, AED: 2, SAR: 2, CAD: 2,
  AUD: 2, SGD: 2, MYR: 2, INR: 2, CNY: 2, HKD: 2, THB: 2,
  NZD: 2, CHF: 2, SEK: 2, NOK: 2, DKK: 2, PLN: 2, CZK: 2,
  HRK: 2, RON: 2, BGN: 2, TRY: 2, BRL: 2, MXN: 2, ARS: 2,
  COP: 2, PEN: 2, EGP: 2, NGN: 2, ZAR: 2, GHS: 2, KES: 2,
  TZS: 2, ETB: 2, MAD: 2, QAR: 2, BDT: 2, LKR: 2, NPR: 2,
  PHP: 2, TWD: 2, UAH: 2, KZT: 2, UZS: 2, AFN: 2,
  // 3 decimal places
  KWD: 3, BHD: 3, OMR: 3, JOD: 3, TND: 3, LYD: 3, IQD: 3,
}

/** Get the number of minor units (decimal places) for a currency. */
export function currencyMinorUnits(currencyCode: string): number {
  return CURRENCY_MINOR_UNITS[currencyCode.toUpperCase()] ?? 2
}

/**
 * Format a monetary amount using the organization's currency and locale.
 * Falls back gracefully if currency/locale is unknown.
 *
 * @param amount     Raw amount (as stored in DB — numeric with 2 decimal places)
 * @param currency   ISO 4217 code, e.g. 'USD', 'EUR', 'JPY', 'PKR'
 * @param locale     BCP 47 locale, e.g. 'en-US', 'en-GB', 'ja-JP', 'ur-PK'
 */
export function formatCurrency(
  amount: number,
  currency = 'USD',
  locale = 'en-US'
): string {
  const decimals = currencyMinorUnits(currency)
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount)
  } catch {
    // Fallback if browser doesn't support the locale/currency combo
    return `${currency} ${amount.toFixed(decimals)}`
  }
}

/**
 * Format a date using the organization's locale and timezone.
 *
 * @param date      Date to format
 * @param locale    BCP 47 locale, e.g. 'en-US', 'ja-JP', 'ar-AE'
 * @param timezone  IANA timezone, e.g. 'America/New_York', 'Asia/Dubai'
 */
export function formatDate(
  date: Date | string,
  locale = 'en-US',
  timezone?: string
): string {
  try {
    const opts: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...(timezone ? { timeZone: timezone } : {}),
    }
    return new Intl.DateTimeFormat(locale, opts).format(new Date(date))
  } catch {
    return new Date(date).toISOString().split('T')[0]
  }
}

/**
 * Format a date+time using the organization's locale and timezone.
 */
export function formatDateTime(
  date: Date | string,
  locale = 'en-US',
  timezone?: string
): string {
  try {
    const opts: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...(timezone ? { timeZone: timezone } : {}),
    }
    return new Intl.DateTimeFormat(locale, opts).format(new Date(date))
  } catch {
    return new Date(date).toISOString()
  }
}

/**
 * Canonical list of supported currencies for the UI.
 * Use ISO 4217 codes throughout — do not hardcode symbols.
 */
export const SUPPORTED_CURRENCIES = [
  { code: 'USD', name: 'US Dollar',           symbol: '$',    region: 'Americas' },
  { code: 'EUR', name: 'Euro',                symbol: '€',    region: 'Europe' },
  { code: 'GBP', name: 'British Pound',       symbol: '£',    region: 'Europe' },
  { code: 'CAD', name: 'Canadian Dollar',     symbol: 'CA$',  region: 'Americas' },
  { code: 'AUD', name: 'Australian Dollar',   symbol: 'A$',   region: 'Oceania' },
  { code: 'NZD', name: 'New Zealand Dollar',  symbol: 'NZ$',  region: 'Oceania' },
  { code: 'CHF', name: 'Swiss Franc',         symbol: 'CHF',  region: 'Europe' },
  { code: 'SEK', name: 'Swedish Krona',       symbol: 'kr',   region: 'Europe' },
  { code: 'NOK', name: 'Norwegian Krone',     symbol: 'kr',   region: 'Europe' },
  { code: 'DKK', name: 'Danish Krone',        symbol: 'kr',   region: 'Europe' },
  { code: 'AED', name: 'UAE Dirham',          symbol: 'AED',  region: 'Middle East' },
  { code: 'SAR', name: 'Saudi Riyal',         symbol: 'SAR',  region: 'Middle East' },
  { code: 'QAR', name: 'Qatari Riyal',        symbol: 'QAR',  region: 'Middle East' },
  { code: 'KWD', name: 'Kuwaiti Dinar',       symbol: 'KD',   region: 'Middle East' },
  { code: 'BHD', name: 'Bahraini Dinar',      symbol: 'BD',   region: 'Middle East' },
  { code: 'OMR', name: 'Omani Rial',          symbol: 'OMR',  region: 'Middle East' },
  { code: 'JOD', name: 'Jordanian Dinar',     symbol: 'JD',   region: 'Middle East' },
  { code: 'PKR', name: 'Pakistani Rupee',     symbol: 'Rs',   region: 'South Asia' },
  { code: 'INR', name: 'Indian Rupee',        symbol: '₹',    region: 'South Asia' },
  { code: 'BDT', name: 'Bangladeshi Taka',    symbol: '৳',    region: 'South Asia' },
  { code: 'LKR', name: 'Sri Lankan Rupee',    symbol: 'Rs',   region: 'South Asia' },
  { code: 'NPR', name: 'Nepalese Rupee',      symbol: 'Rs',   region: 'South Asia' },
  { code: 'JPY', name: 'Japanese Yen',        symbol: '¥',    region: 'East Asia' },
  { code: 'CNY', name: 'Chinese Yuan',        symbol: '¥',    region: 'East Asia' },
  { code: 'HKD', name: 'Hong Kong Dollar',    symbol: 'HK$',  region: 'East Asia' },
  { code: 'KRW', name: 'South Korean Won',    symbol: '₩',    region: 'East Asia' },
  { code: 'TWD', name: 'Taiwan Dollar',       symbol: 'NT$',  region: 'East Asia' },
  { code: 'SGD', name: 'Singapore Dollar',    symbol: 'S$',   region: 'Southeast Asia' },
  { code: 'MYR', name: 'Malaysian Ringgit',   symbol: 'RM',   region: 'Southeast Asia' },
  { code: 'THB', name: 'Thai Baht',           symbol: '฿',    region: 'Southeast Asia' },
  { code: 'PHP', name: 'Philippine Peso',     symbol: '₱',    region: 'Southeast Asia' },
  { code: 'IDR', name: 'Indonesian Rupiah',   symbol: 'Rp',   region: 'Southeast Asia' },
  { code: 'VND', name: 'Vietnamese Dong',     symbol: '₫',    region: 'Southeast Asia' },
  { code: 'ZAR', name: 'South African Rand',  symbol: 'R',    region: 'Africa' },
  { code: 'NGN', name: 'Nigerian Naira',      symbol: '₦',    region: 'Africa' },
  { code: 'KES', name: 'Kenyan Shilling',     symbol: 'KSh',  region: 'Africa' },
  { code: 'GHS', name: 'Ghanaian Cedi',       symbol: '₵',    region: 'Africa' },
  { code: 'EGP', name: 'Egyptian Pound',      symbol: 'E£',   region: 'Africa' },
  { code: 'MAD', name: 'Moroccan Dirham',     symbol: 'MAD',  region: 'Africa' },
  { code: 'TRY', name: 'Turkish Lira',        symbol: '₺',    region: 'Europe' },
  { code: 'BRL', name: 'Brazilian Real',      symbol: 'R$',   region: 'Americas' },
  { code: 'MXN', name: 'Mexican Peso',        symbol: 'MX$',  region: 'Americas' },
  { code: 'ARS', name: 'Argentine Peso',      symbol: '$',    region: 'Americas' },
] as const

export type SupportedCurrencyCode = typeof SUPPORTED_CURRENCIES[number]['code']

/** Quick lookup: is a currency code in our supported list? */
export function isSupportedCurrency(code: string): boolean {
  return SUPPORTED_CURRENCIES.some(c => c.code === code.toUpperCase())
}

/**
 * Common IANA timezones grouped by region, for use in UI dropdowns.
 * Source: IANA tz database. Use `Intl.supportedValuesOf('timeZone')` at runtime
 * for the full browser-supported list.
 */
export const TIMEZONE_GROUPS = [
  {
    region: 'Americas',
    timezones: [
      { id: 'America/New_York',      label: 'Eastern Time (US & Canada)' },
      { id: 'America/Chicago',       label: 'Central Time (US & Canada)' },
      { id: 'America/Denver',        label: 'Mountain Time (US & Canada)' },
      { id: 'America/Los_Angeles',   label: 'Pacific Time (US & Canada)' },
      { id: 'America/Anchorage',     label: 'Alaska' },
      { id: 'Pacific/Honolulu',      label: 'Hawaii' },
      { id: 'America/Toronto',       label: 'Toronto' },
      { id: 'America/Vancouver',     label: 'Vancouver' },
      { id: 'America/Mexico_City',   label: 'Mexico City' },
      { id: 'America/Sao_Paulo',     label: 'São Paulo' },
      { id: 'America/Buenos_Aires',  label: 'Buenos Aires' },
      { id: 'America/Bogota',        label: 'Bogotá' },
    ],
  },
  {
    region: 'Europe',
    timezones: [
      { id: 'Europe/London',         label: 'London (GMT/BST)' },
      { id: 'Europe/Dublin',         label: 'Dublin' },
      { id: 'Europe/Lisbon',         label: 'Lisbon' },
      { id: 'Europe/Paris',          label: 'Paris / Berlin / Madrid' },
      { id: 'Europe/Amsterdam',      label: 'Amsterdam' },
      { id: 'Europe/Brussels',       label: 'Brussels' },
      { id: 'Europe/Rome',           label: 'Rome' },
      { id: 'Europe/Warsaw',         label: 'Warsaw' },
      { id: 'Europe/Helsinki',       label: 'Helsinki' },
      { id: 'Europe/Athens',         label: 'Athens' },
      { id: 'Europe/Istanbul',       label: 'Istanbul' },
      { id: 'Europe/Moscow',         label: 'Moscow' },
      { id: 'Europe/Stockholm',      label: 'Stockholm' },
      { id: 'Europe/Zurich',         label: 'Zurich' },
    ],
  },
  {
    region: 'Middle East & Africa',
    timezones: [
      { id: 'Asia/Dubai',            label: 'Dubai / Abu Dhabi (GST)' },
      { id: 'Asia/Riyadh',           label: 'Riyadh (AST)' },
      { id: 'Asia/Kuwait',           label: 'Kuwait' },
      { id: 'Asia/Qatar',            label: 'Doha (Qatar)' },
      { id: 'Asia/Bahrain',          label: 'Bahrain' },
      { id: 'Asia/Muscat',           label: 'Muscat (Oman)' },
      { id: 'Asia/Amman',            label: 'Amman (Jordan)' },
      { id: 'Asia/Beirut',           label: 'Beirut' },
      { id: 'Asia/Tehran',           label: 'Tehran' },
      { id: 'Africa/Cairo',          label: 'Cairo' },
      { id: 'Africa/Nairobi',        label: 'Nairobi' },
      { id: 'Africa/Lagos',          label: 'Lagos' },
      { id: 'Africa/Johannesburg',   label: 'Johannesburg' },
      { id: 'Africa/Casablanca',     label: 'Casablanca' },
    ],
  },
  {
    region: 'South Asia',
    timezones: [
      { id: 'Asia/Karachi',          label: 'Karachi (PKT)' },
      { id: 'Asia/Kolkata',          label: 'Mumbai / New Delhi (IST)' },
      { id: 'Asia/Colombo',          label: 'Colombo (Sri Lanka)' },
      { id: 'Asia/Dhaka',            label: 'Dhaka (BST)' },
      { id: 'Asia/Kathmandu',        label: 'Kathmandu' },
      { id: 'Asia/Kabul',            label: 'Kabul' },
    ],
  },
  {
    region: 'East & Southeast Asia',
    timezones: [
      { id: 'Asia/Tokyo',            label: 'Tokyo (JST)' },
      { id: 'Asia/Shanghai',         label: 'Beijing / Shanghai (CST)' },
      { id: 'Asia/Hong_Kong',        label: 'Hong Kong' },
      { id: 'Asia/Seoul',            label: 'Seoul (KST)' },
      { id: 'Asia/Taipei',           label: 'Taipei' },
      { id: 'Asia/Singapore',        label: 'Singapore (SGT)' },
      { id: 'Asia/Kuala_Lumpur',     label: 'Kuala Lumpur' },
      { id: 'Asia/Bangkok',          label: 'Bangkok (ICT)' },
      { id: 'Asia/Jakarta',          label: 'Jakarta (WIB)' },
      { id: 'Asia/Manila',           label: 'Manila (PHT)' },
      { id: 'Asia/Ho_Chi_Minh',      label: 'Ho Chi Minh City' },
      { id: 'Asia/Rangoon',          label: 'Yangon (MMT)' },
    ],
  },
  {
    region: 'Oceania',
    timezones: [
      { id: 'Australia/Sydney',      label: 'Sydney (AEST)' },
      { id: 'Australia/Melbourne',   label: 'Melbourne' },
      { id: 'Australia/Brisbane',    label: 'Brisbane' },
      { id: 'Australia/Perth',       label: 'Perth (AWST)' },
      { id: 'Australia/Adelaide',    label: 'Adelaide (ACST)' },
      { id: 'Pacific/Auckland',      label: 'Auckland (NZST)' },
      { id: 'Pacific/Fiji',          label: 'Fiji' },
    ],
  },
  {
    region: 'UTC',
    timezones: [
      { id: 'UTC',                   label: 'UTC (Coordinated Universal Time)' },
    ],
  },
] as const

/** All timezone IDs in a flat array */
export const ALL_TIMEZONES: ReadonlyArray<{ id: string; label: string }> = TIMEZONE_GROUPS.flatMap(g => g.timezones as ReadonlyArray<{ id: string; label: string }>)

/**
 * Check if a timezone ID is valid.
 *
 * Uses Intl.DateTimeFormat to validate — this accepts all IANA timezone IDs
 * including 'UTC' (which is NOT in Intl.supportedValuesOf('timeZone') on Node 22
 * but IS accepted by DateTimeFormat).
 *
 * Intl.supportedValuesOf('timeZone') is available on Node 20+ and Vercel Node 20+.
 * We use DateTimeFormat validation instead to cover 'UTC' and avoid
 * maintaining a static list. Both approaches are equivalent for our use case.
 */
export function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Get all supported timezone IDs from the runtime.
 * Falls back to the curated TIMEZONE_GROUPS list if not available.
 * UTC is added explicitly since Intl.supportedValuesOf omits it on some runtimes.
 */
export function getRuntimeTimezones(): string[] {
  try {
    const tzs = Intl.supportedValuesOf('timeZone')
    // UTC is valid but not in the list on Node 22 — add it
    return ['UTC', ...tzs]
  } catch {
    // Fallback for environments without supportedValuesOf (Node < 20)
    return ['UTC', ...ALL_TIMEZONES.map(t => t.id)]
  }
}
