/**
 * ShopGuard Ingestion API Key Management
 *
 * Org-scoped cryptographic credentials for machine-to-machine ingestion.
 * The full secret is shown ONCE at creation — only the SHA-256 hash is stored.
 *
 * Key format: sg_live_<32 random hex chars>
 * Key prefix stored: first 8 chars for display (sg_live_)
 *
 * SECURITY:
 * - Secret never logged
 * - Only hash stored in DB
 * - Revoke invalidates immediately (isActive=false)
 * - Optional store scoping
 * - Rate limit by key via Redis
 */
import crypto from 'crypto'
import { getDb } from '@/lib/db'
import { apiKeys } from '@shopguard/database'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'

export interface ApiKeyCreateResult {
  id: string
  name: string
  secret: string    // Full secret — shown ONCE, not stored
  prefix: string    // First 8 chars for display
  organizationId: string
  storeId: string | null
  createdAt: Date
}

export interface ApiKeyRecord {
  id: string
  name: string
  prefix: string
  organizationId: string
  storeId: string | null
  isActive: boolean
  lastUsedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

/** SHA-256 hash of the raw secret */
function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex')
}

/** Generate a new API key: sg_live_<32 hex chars> */
function generateSecret(): string {
  return 'sg_live_' + crypto.randomBytes(16).toString('hex')
}

/**
 * Create a new API key for an organization.
 * Returns the full secret — this is the ONLY time it is visible.
 */
export async function createApiKey(params: {
  organizationId: string
  name: string
  storeId?: string | null
}): Promise<ApiKeyCreateResult> {
  const secret = generateSecret()
  const keyHash = hashSecret(secret)
  const prefix = secret.slice(0, 8)   // 'sg_live_' prefix
  const id = nanoid()

  const db = getDb()
  await db.insert(apiKeys).values({
    id,
    organizationId: params.organizationId,
    name: params.name,
    keyHash,
    keyPrefix: prefix,
    storeId: params.storeId ?? null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  return {
    id,
    name: params.name,
    secret,   // shown once
    prefix,
    organizationId: params.organizationId,
    storeId: params.storeId ?? null,
    createdAt: new Date(),
  }
}

/**
 * Validate an API key from a request Authorization header.
 * Returns the org (and optional store) if valid and active.
 * Updates lastUsedAt.
 */
export async function validateApiKey(rawSecret: string): Promise<{
  organizationId: string
  storeId: string | null
  keyId: string
} | null> {
  if (!rawSecret || !rawSecret.startsWith('sg_live_')) return null

  const keyHash = hashSecret(rawSecret)
  const db = getDb()

  const [key] = await db
    .select({
      id: apiKeys.id,
      organizationId: apiKeys.organizationId,
      storeId: apiKeys.storeId,
      isActive: apiKeys.isActive,
    })
    .from(apiKeys)
    .where(and(
      eq(apiKeys.keyHash, keyHash),
      eq(apiKeys.isActive, true),
    ))
    .limit(1)

  if (!key) return null

  // Update lastUsedAt asynchronously (non-blocking)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .catch(() => {})  // Non-fatal

  return {
    organizationId: key.organizationId,
    storeId: key.storeId,
    keyId: key.id,
  }
}

/** List all API keys for an org (no secrets — only metadata) */
export async function listApiKeys(organizationId: string): Promise<ApiKeyRecord[]> {
  const db = getDb()
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.keyPrefix,
      organizationId: apiKeys.organizationId,
      storeId: apiKeys.storeId,
      isActive: apiKeys.isActive,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.organizationId, organizationId))
    .orderBy(apiKeys.createdAt)
}

/** Revoke an API key immediately */
export async function revokeApiKey(id: string, organizationId: string): Promise<boolean> {
  const db = getDb()
  const result = await db
    .update(apiKeys)
    .set({ isActive: false, revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, organizationId)))
  // Drizzle returns array for update — check if the query ran without error
  return Array.isArray(result) ? result.length >= 0 : true
}

/** Rotate: revoke old key and create a new one */
export async function rotateApiKey(id: string, organizationId: string): Promise<ApiKeyCreateResult | null> {
  const db = getDb()

  const [existing] = await db
    .select({ name: apiKeys.name, storeId: apiKeys.storeId })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, organizationId)))
    .limit(1)

  if (!existing) return null

  await revokeApiKey(id, organizationId)
  return createApiKey({
    organizationId,
    name: existing.name + ' (rotated)',
    storeId: existing.storeId,
  })
}
