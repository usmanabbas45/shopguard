/**
 * GET  /api/settings/organization  — Load organization settings
 * PUT  /api/settings/organization  — Save organization settings
 *
 * Tenant isolation: all reads/writes scoped to session.organizationId.
 * Validation: currency, timezone, locale, country validated server-side.
 * Demo orgs: settings are readable but not writable.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { organizations } from '@shopguard/database'
import { eq } from 'drizzle-orm'
import { isSupportedCurrency, isValidTimezone, SUPPORTED_CURRENCIES } from '@/lib/money'
import { z } from 'zod'

// ── Allowed locales ───────────────────────────────────────────────────────────

const ALLOWED_LOCALES = [
  'en-US', 'en-GB', 'en-AU', 'en-CA', 'en-NZ', 'en-IE', 'en-ZA', 'en-IN', 'en-PK', 'en-NG',
  'de-DE', 'de-AT', 'de-CH',
  'fr-FR', 'fr-BE', 'fr-CA', 'fr-CH',
  'es-ES', 'es-MX', 'es-AR', 'es-CO', 'es-CL',
  'it-IT', 'pt-BR', 'pt-PT',
  'nl-NL', 'nl-BE',
  'pl-PL', 'cs-CZ', 'sk-SK', 'ro-RO', 'hu-HU',
  'sv-SE', 'no-NO', 'da-DK', 'fi-FI',
  'ru-RU', 'uk-UA', 'tr-TR',
  'ar-AE', 'ar-SA', 'ar-EG', 'ar-KW', 'ar-QA',
  'he-IL',
  'fa-IR',
  'ur-PK',
  'hi-IN', 'bn-BD', 'ta-IN', 'te-IN',
  'zh-CN', 'zh-TW', 'zh-HK',
  'ja-JP', 'ko-KR',
  'th-TH', 'vi-VN', 'id-ID', 'ms-MY',
  'sw-KE', 'am-ET',
] as const

type AllowedLocale = typeof ALLOWED_LOCALES[number]

function isAllowedLocale(v: string): v is AllowedLocale {
  return (ALLOWED_LOCALES as readonly string[]).includes(v)
}

// ISO 3166-1 alpha-2 (partial — covers 99% of users)
const ALLOWED_COUNTRIES = new Set([
  'US','GB','CA','AU','NZ','IE','ZA','NG','GH','KE','TZ','ET','EG','MA','DZ','TN',
  'DE','FR','ES','IT','NL','BE','CH','AT','PL','CZ','SK','RO','HU','SE','NO','DK','FI',
  'PT','GR','HR','BG','RS','SI','LT','LV','EE','LU','MT','CY',
  'RU','UA','TR','IL','SA','AE','KW','QA','BH','OM','JO','LB','IQ','IR','PK',
  'IN','BD','LK','NP','AF','MM','TH','VN','ID','MY','PH','SG','KH','LA',
  'CN','JP','KR','TW','HK','MO',
  'BR','MX','AR','CO','CL','PE','VE','EC','BO','UY','PY',
  'OTHER',
])

// ── Validation schema ─────────────────────────────────────────────────────────

const OrgSettingsSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  currency: z.string()
    .toUpperCase()
    .refine(isSupportedCurrency, { message: 'Unsupported currency code' })
    .optional(),
  timezone: z.string()
    .refine(isValidTimezone, { message: 'Invalid IANA timezone identifier' })
    .optional(),
  locale: z.string()
    .refine(isAllowedLocale, { message: 'Unsupported locale' })
    .optional(),
  country: z.string()
    .length(2)
    .toUpperCase()
    .refine(v => ALLOWED_COUNTRIES.has(v), { message: 'Unsupported country code' })
    .optional()
    .nullable(),
  countryCode: z.string().max(6).optional().nullable(),
  businessType: z.string().max(100).optional().nullable(),
})

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()
  const [org] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      currency: organizations.currency,
      timezone: organizations.timezone,
      locale: organizations.locale,
      country: organizations.country,
      countryCode: organizations.countryCode,
      businessType: organizations.businessType,
      isDemo: organizations.isDemo,
    })
    .from(organizations)
    .where(eq(organizations.id, session.organizationId))
    .limit(1)

  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

  return NextResponse.json({ org })
}

// ── PUT ───────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only OWNER and ADMIN can change org settings
  if (!['OWNER', 'ADMIN'].includes(session.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  // Demo orgs are read-only
  if (session.isDemo) {
    return NextResponse.json({ error: 'Demo organization settings cannot be changed' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Server-side validation
  const parsed = OrgSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      error: 'Validation failed',
      issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    }, { status: 422 })
  }

  const updates = parsed.data
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const db = getDb()

  // CRITICAL: always scope update to session.organizationId
  // This prevents IDOR — a user cannot update another org's settings
  await db
    .update(organizations)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(organizations.id, session.organizationId))

  // Return updated org
  const [updated] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      currency: organizations.currency,
      timezone: organizations.timezone,
      locale: organizations.locale,
      country: organizations.country,
      countryCode: organizations.countryCode,
      businessType: organizations.businessType,
      isDemo: organizations.isDemo,
    })
    .from(organizations)
    .where(eq(organizations.id, session.organizationId))
    .limit(1)

  return NextResponse.json({ org: updated })
}
