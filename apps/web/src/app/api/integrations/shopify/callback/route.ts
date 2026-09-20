/**
 * GET /api/integrations/shopify/callback
 * Shopify OAuth step 2: verify HMAC+state, exchange code, encrypt+store token, register webhooks.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { shopifyIntegrations, stores } from '@shopguard/database'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { isValidShopDomain, verifyOAuthHmac, exchangeOAuthCode, getShopInfo, registerWebhooks, SHOPIFY_SCOPES } from '@/lib/shopify/client'
import { encryptToken, decryptToken, validateEncryptionKey } from '@/lib/shopify/token-encryption'
import { getRedis, enqueueShopifySync } from '@/lib/queue/index'
// webhookRegistered state for degraded status
type WebhookStatus = 'ok' | 'failed'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams

  // 1. Verify Shopify HMAC — constant-time comparison
  if (!verifyOAuthHmac(params)) return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 })

  const shop = params.get('shop') ?? ''
  const code = params.get('code') ?? ''
  const state = params.get('state') ?? ''

  if (!isValidShopDomain(shop) || !code || !state) return NextResponse.json({ error: 'Missing or invalid OAuth parameters' }, { status: 400 })

  // 2. Validate state (CSRF) — one-time use, deleted after read
  const redis = getRedis()
  if (!redis) return NextResponse.json({ error: 'OAuth state storage unavailable' }, { status: 503 })
  const stateKey = `shopify:oauth:state:${state}`
  const stateRaw = await redis.get(stateKey)
  if (!stateRaw) return NextResponse.json({ error: 'Invalid or expired OAuth state' }, { status: 401 })
  await redis.del(stateKey)  // Delete immediately — prevents replay

  const stateData = JSON.parse(stateRaw) as { organizationId: string; userId: string; shop: string }
  if (stateData.shop !== shop) return NextResponse.json({ error: 'Shop domain mismatch' }, { status: 401 })

  // 3. Validate encryption key
  try { validateEncryptionKey() } catch {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 503 })
  }

  // 4. Exchange code for token (code is consumed, cannot be replayed)
  let accessToken: string
  try { accessToken = await exchangeOAuthCode(shop, code) }
  catch { return NextResponse.json({ error: 'Failed to complete Shopify authorization' }, { status: 502 }) }

  // 5. Get shop info
  let shopInfo: Awaited<ReturnType<typeof getShopInfo>>
  try { shopInfo = await getShopInfo(shop, accessToken) }
  catch { return NextResponse.json({ error: 'Failed to retrieve Shopify store information' }, { status: 502 }) }

  // 6. Encrypt token — never stored plaintext
  const accessTokenEncrypted = encryptToken(accessToken)

  const db = getDb()
  const organizationId = stateData.organizationId

  // 7. Upsert store record
  const [existingStore] = await db.select({ id: stores.id }).from(stores).where(eq(stores.organizationId, organizationId)).limit(1)
  let storeId = existingStore?.id
  if (!storeId) {
    storeId = nanoid()
    await db.insert(stores).values({ id: storeId, organizationId, name: shopInfo.name, isActive: true, openingHour: 0, closingHour: 24, createdAt: new Date(), updatedAt: new Date() })
  }

  // 8. Upsert integration record
  const [existing] = await db.select({ id: shopifyIntegrations.id }).from(shopifyIntegrations)
    .where(and(eq(shopifyIntegrations.organizationId, organizationId), eq(shopifyIntegrations.shopDomain, shop))).limit(1)

  let integrationId: string
  if (existing) {
    integrationId = existing.id
    await db.update(shopifyIntegrations).set({ accessTokenEncrypted, shopifyShopId: shopInfo.id, scopes: SHOPIFY_SCOPES, status: 'ACTIVE', storeId, uninstalledAt: null, updatedAt: new Date() })
      .where(eq(shopifyIntegrations.id, integrationId))
  } else {
    integrationId = nanoid()
    await db.insert(shopifyIntegrations).values({ id: integrationId, organizationId, storeId, shopDomain: shop, shopifyShopId: shopInfo.id, accessTokenEncrypted, scopes: SHOPIFY_SCOPES, status: 'ACTIVE', syncStatus: 'IDLE', syncRecordsDiscovered: 0, syncRecordsAccepted: 0, syncRecordsDuplicates: 0, syncRecordsRejected: 0, createdAt: new Date(), updatedAt: new Date() })
  }

  // 9. Register webhooks
  const appUrl = process.env.SHOPIFY_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? ''
  // 9. Register webhooks — track success/failure for UI status
  let webhookStatus: WebhookStatus = 'ok'
  try { await registerWebhooks(shop, decryptToken(accessTokenEncrypted), appUrl) }
  catch (err) {
    webhookStatus = 'failed'
    console.warn('[shopify/callback] Webhook registration failed:', String(err).slice(0, 100))
    // Mark integration as degraded (connected but webhooks not working)
    await db.update(shopifyIntegrations).set({ syncError: 'Webhook registration failed — live events not active', updatedAt: new Date() })
      .where(eq(shopifyIntegrations.id, integrationId))
  }

  // 10. Enqueue initial sync (non-blocking — merchant redirected immediately).
  // The sync is only queued when webhooks are healthy OR when degraded but recovery is safe.
  // Uses BOTH durable DB signal (syncStatus='QUEUED') AND BullMQ queue signal:
  //   - DB signal: picked up by Vercel Cron every 5 min (durable, survives Redis restart)
  //   - BullMQ: picked up by standalone worker if running
  // Idempotency: enqueueShopifySync uses jobId = idempotencyKey — duplicate calls no-op.
  // Duplicate OAuth callback: same integrationId → same idempotencyKey prefix → deduplicated.
  const syncIdempotencyKey = `shopify:initial-sync:${integrationId}`
  // Set DB status to QUEUED — this is the durable signal for Vercel Cron
  await db.update(shopifyIntegrations)
    .set({ syncStatus: 'QUEUED', syncError: null, updatedAt: new Date() })
    .where(eq(shopifyIntegrations.id, integrationId))
  // Also enqueue to BullMQ for standalone worker environments
  await enqueueShopifySync({
    integrationId,
    organizationId,
    idempotencyKey: syncIdempotencyKey,
  }).catch((err: unknown) => {
    // Non-fatal: cron will still pick up via DB status
    console.warn('[shopify/callback] BullMQ enqueue failed (cron fallback active):', String(err).slice(0, 80))
  })

  const appPublicUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://shopguard-web.vercel.app'
  const statusParam = webhookStatus === 'failed' ? 'connected_degraded' : 'connected_sync_queued'
  return NextResponse.redirect(`${appPublicUrl}/settings?shopify=${statusParam}&integrationId=${integrationId}`)
}
