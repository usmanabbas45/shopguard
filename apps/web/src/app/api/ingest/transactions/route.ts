/**
 * POST /api/ingest/transactions
 *
 * Live transaction ingestion endpoint for POS systems and external sources.
 * Accepts a batch of transactions via authenticated API key.
 *
 * AUTHENTICATION:
 *   Authorization: Bearer sg_live_<key>
 *   The key is validated against the org's api_keys table.
 *   Session cookies are NOT used — this is machine-to-machine.
 *
 * IDEMPOTENCY:
 *   Each transaction must have an externalTransactionId.
 *   Duplicate submissions (same org + externalTransactionId) are ignored safely.
 *   Returns status 200 with { accepted, duplicates, rejected } counts.
 *
 * SECURITY:
 *   - API key validated via SHA-256 hash
 *   - Rate limited via Redis (1000 req/min per key)
 *   - Max payload: 5MB
 *   - Max batch: 500 transactions
 *   - No PAN/CVV/PIN accepted
 *   - All writes scoped to key's organizationId (no IDOR)
 *   - Demo orgs cannot receive live data
 *
 * SUPPORTED TRANSACTION TYPES:
 *   SALE, REFUND, PARTIAL_REFUND, VOID, REVERSAL, CHARGEBACK
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { getDb } from '@/lib/db'
import {
  transactions, stores, employees, registers, organizations,
} from '@shopguard/database'
import { eq, and } from 'drizzle-orm'
import { validateApiKey } from '@/lib/ingestion/api-keys'
import { checkRateLimit } from '@/lib/ingestion/rate-limit'
import { normalizePaymentMethod } from '@/lib/payment-methods'
import { isSupportedCurrency } from '@/lib/money'
import { enqueueAnalysis, getRedis, QUEUE_NAMES, runJobInline } from '@/lib/queue/index'

export const runtime = 'nodejs'

// ── Request schema ────────────────────────────────────────────────────────────

const TransactionSchema = z.object({
  externalTransactionId: z.string().min(1).max(200),
  storeCode: z.string().optional(),           // Match to stores.code
  registerCode: z.string().optional(),
  employeeCode: z.string().optional(),        // Match to employees.code
  timestamp: z.string().datetime(),
  currency: z.string().length(3),
  grossAmount: z.number().finite(),
  discountAmount: z.number().finite().default(0),
  refundAmount: z.number().finite().default(0),
  netAmount: z.number().finite(),
  paymentMethod: z.string().optional(),
  paymentChannel: z.enum(['IN_STORE', 'ONLINE', 'MOBILE_APP', 'PHONE', 'KIOSK']).optional(),
  paymentReference: z.string().max(200).optional(), // Safe payment ref — NOT card number
  paymentLast4: z.string().length(4).regex(/^\d{4}$/).optional(),
  paymentBrand: z.string().max(50).optional(),
  transactionType: z.enum(['SALE', 'REFUND', 'PARTIAL_REFUND', 'VOID', 'REVERSAL', 'CHARGEBACK']).default('SALE'),
  itemCount: z.number().int().min(0).optional(),
  durationSeconds: z.number().int().min(0).optional(),
  hasPriceOverride: z.boolean().default(false),
  discountPercent: z.number().min(0).max(100).optional(),
  notes: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
})
  // SECURITY: reject any field that looks like a card number
  .refine(t => !t.paymentReference || !/^\d{13,19}$/.test(t.paymentReference), {
    message: 'paymentReference must not be a card number',
    path: ['paymentReference'],
  })

const IngestSchema = z.object({
  transactions: z.array(TransactionSchema).min(1).max(500),
  source: z.string().max(50).optional().default('api'),   // e.g. 'square', 'shopify', 'custom'
})

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    return await handleIngest(req)
  } catch (err) {
    // Top-level catch: log internally, return neutral error (no stack trace)
    console.error('[ingest] Unhandled error:', String(err).slice(0, 200))
    return NextResponse.json({ error: 'Ingestion service error' }, { status: 500 })
  }
}

async function handleIngest(req: NextRequest) {
  // 1. Body size check (5MB max)
  const contentLength = parseInt(req.headers.get('content-length') ?? '0')
  if (contentLength > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'Payload too large (max 5MB)' }, { status: 413 })
  }

  // 2. API key authentication
  const authHeader = req.headers.get('authorization') ?? ''
  const rawKey = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!rawKey) {
    return NextResponse.json({ error: 'Missing Authorization header (Bearer sg_live_...)' }, { status: 401 })
  }

  const keyRecord = await validateApiKey(rawKey)
  if (!keyRecord) {
    return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 })
  }

  const { organizationId, storeId: keyScopeStoreId, keyId } = keyRecord

  // 3. Rate limiting
  const rateCheck = await checkRateLimit(keyId)
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', resetAt: rateCheck.resetAt },
      {
        status: 429,
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rateCheck.resetAt),
          'Retry-After': '60',
        }
      }
    )
  }

  // 4. Check org exists and is not a demo org
  const db = getDb()
  const [org] = await db
    .select({ id: organizations.id, isDemo: organizations.isDemo, isActive: organizations.isActive, currency: organizations.currency })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1)

  if (!org || !org.isActive) {
    return NextResponse.json({ error: 'Organization not found or inactive' }, { status: 404 })
  }
  if (org.isDemo) {
    return NextResponse.json({ error: 'Demo organizations cannot receive live transaction data' }, { status: 403 })
  }

  // 5. Parse body
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = IngestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      error: 'Validation failed',
      issues: parsed.error.issues.slice(0, 10).map(i => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    }, { status: 422 })
  }

  const { transactions: inboundTxns, source } = parsed.data

  // 6. Validate currencies
  for (const t of inboundTxns) {
    if (!isSupportedCurrency(t.currency)) {
      return NextResponse.json({
        error: `Unsupported currency: ${t.currency} in transaction ${t.externalTransactionId}`,
      }, { status: 422 })
    }
  }

  // 7. Resolve store/register/employee lookups
  const orgStores = await db.select({ id: stores.id, code: stores.code })
    .from(stores).where(eq(stores.organizationId, organizationId))
  const orgEmployees = await db.select({ id: employees.id, code: employees.code, externalId: employees.externalId })
    .from(employees).where(eq(employees.organizationId, organizationId))
  const orgRegisters = await db.select({ id: registers.id, code: registers.code, storeId: registers.storeId })
    .from(registers).where(eq(registers.organizationId, organizationId))

  const storeByCode = new Map(orgStores.map(s => [s.code, s.id]))
  const employeeByCode = new Map(orgEmployees.map(e => [e.code ?? e.externalId, e.id]))
  const registerByCode = new Map(orgRegisters.map(r => [r.code, r.id]))

  // Default store: first store if key is not store-scoped
  const defaultStoreId = keyScopeStoreId ?? orgStores[0]?.id

  // 8. Process transactions
  const accepted: string[] = []
  const duplicates: string[] = []
  const rejected: { id: string; reason: string }[] = []

  for (const t of inboundTxns) {
    try {
      const resolvedStoreId = (t.storeCode ? storeByCode.get(t.storeCode) : undefined) ?? keyScopeStoreId ?? defaultStoreId
      if (!resolvedStoreId) {
        rejected.push({ id: t.externalTransactionId, reason: 'No matching store found' })
        continue
      }

      const resolvedEmployeeId = t.employeeCode ? (employeeByCode.get(t.employeeCode) ?? null) : null
      const resolvedRegisterId = t.registerCode ? (registerByCode.get(t.registerCode) ?? null) : null
      const normalizedPayment = normalizePaymentMethod(t.paymentMethod ?? null)
      const isVoid = t.transactionType === 'VOID' || t.transactionType === 'REVERSAL'
      const isRefund = t.transactionType === 'REFUND' || t.transactionType === 'PARTIAL_REFUND' || t.transactionType === 'CHARGEBACK'

      const txId = nanoid()
      await db.insert(transactions).values({
        id: txId,
        organizationId,
        storeId: resolvedStoreId,
        registerId: resolvedRegisterId,
        employeeId: resolvedEmployeeId,
        externalTransactionId: t.externalTransactionId,
        timestamp: new Date(t.timestamp),
        currency: t.currency.toUpperCase(),
        grossAmount: t.grossAmount.toFixed(2),
        discountAmount: t.discountAmount.toFixed(2),
        refundAmount: t.refundAmount.toFixed(2),
        netAmount: t.netAmount.toFixed(2),
        paymentMethod: normalizedPayment,
        paymentChannel: t.paymentChannel ?? null,
        paymentProvider: source,
        paymentReference: t.paymentReference ?? null,
        paymentLast4: t.paymentLast4 ?? null,
        paymentBrand: t.paymentBrand ?? null,
        transactionStatus: isVoid ? 'VOIDED' : isRefund ? 'REFUNDED' : 'COMPLETED',
        isVoid,
        isRefund,
        isNoSale: false,
        hasPriceOverride: t.hasPriceOverride,
        discountPercent: t.discountPercent?.toFixed(2) ?? null,
        itemCount: t.itemCount ?? null,
        durationSeconds: t.durationSeconds ?? null,
        notes: t.notes ?? null,
        metadata: t.metadata ?? null,
        source: `api_${source}`,
        dataSource: 'API',
        isDemo: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      // onConflictDoNothing is intentionally NOT used here.
      // Instead we catch the unique constraint violation below.
      // This ensures accepted[] only grows when persistence actually succeeded.
      accepted.push(txId)
    } catch (err: unknown) {
      const msg = String(err)
      if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('23505')) {
        duplicates.push(t.externalTransactionId)
      } else {
        rejected.push({ id: t.externalTransactionId, reason: 'Database error' })
      }
    }
  }

  // 9. Queue analysis for accepted transactions
  if (accepted.length > 0) {
    const redis = getRedis()
    if (redis) {
      await enqueueAnalysis({ organizationId, transactionIds: accepted, idempotencyKey: `ingest:${nanoid()}` }).catch(() => {})
    } else {
      Promise.resolve().then(() =>
        runJobInline(QUEUE_NAMES.ANALYSIS, { organizationId, transactionIds: accepted, idempotencyKey: `ingest:${nanoid()}` })
      ).catch(() => {})
    }
  }

  // 10. Update ingestion stats (fire and forget)
  updateIngestionStats(organizationId, source, {
    received: inboundTxns.length,
    accepted: accepted.length,
    duplicates: duplicates.length,
    rejected: rejected.length,
  }).catch(() => {})

  return NextResponse.json({
    received: inboundTxns.length,
    accepted: accepted.length,
    duplicates: duplicates.length,
    rejected: rejected.length,
    rejectedDetails: rejected.length > 0 ? rejected : undefined,
  }, {
    headers: {
      'X-RateLimit-Remaining': String(rateCheck.remaining),
      'X-RateLimit-Reset': String(rateCheck.resetAt),
    }
  })
}

// ── Ingestion stats helper ────────────────────────────────────────────────────

async function updateIngestionStats(
  organizationId: string,
  source: string,
  counts: { received: number; accepted: number; duplicates: number; rejected: number }
) {
  // Simple Redis counter — not critical path
  const redis = getRedis()
  if (!redis) return
  const key = `ingest:stats:${organizationId}:${source}:${new Date().toISOString().slice(0, 10)}`
  await redis.hincrby(key, 'received', counts.received)
  await redis.hincrby(key, 'accepted', counts.accepted)
  await redis.hincrby(key, 'duplicates', counts.duplicates)
  await redis.hincrby(key, 'rejected', counts.rejected)
  await redis.hset(key, 'lastAt', new Date().toISOString())
  await redis.expire(key, 60 * 60 * 24 * 7)  // 7 days
}

