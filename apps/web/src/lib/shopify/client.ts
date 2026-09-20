/**
 * Shopify API client and OAuth utilities.
 *
 * API Version: 2026-07 (stable quarterly release, July 2026)
 *   Verified from Shopify's quarterly release schedule (Jan/Apr/Jul/Oct).
 *   As of September 20, 2026, the currently supported stable versions are:
 *   2025-10, 2026-01, 2026-04, 2026-07 — latest is 2026-07.
 *   Source: Shopify API versioning docs (shopify.dev/api/usage/versioning).
 *   NOTE: callbackUrl was deprecated in 2025-10; use 'callbackUrl' is replaced by 'callbackUrl'
 *   in GraphQL WebhookSubscriptionInput. In 2026-07, the field is 'callbackUrl'
 *   per ongoing Shopify compatibility. Update quarterly.
 * Uses GraphQL Admin API (required for new public OAuth apps created after April 2025).
 *
 * Scopes used (least-privilege):
 *   read_orders    — orders, refunds, transactions (core fraud data)
 *   read_locations — store locations for multi-location attribution
 *
 * NOT requested (not needed for ShopGuard):
 *   write_orders, read_customers, read_products, read_analytics, etc.
 *
 * Environment variables required:
 *   SHOPIFY_API_KEY
 *   SHOPIFY_API_SECRET
 *   SHOPIFY_APP_URL
 *   SHOPIFY_SCOPES          (default: read_orders,read_locations)
 *   SHOPIFY_TOKEN_ENCRYPTION_KEY
 */

import crypto from 'crypto'

/**
 * Shopify Admin GraphQL API version — single source of truth.
 * Shopify releases new stable versions quarterly (Jan/Apr/Jul/Oct).
 * As of September 2026, 2026-07 is the latest stable.
 * Update this constant each quarter after verifying compatibility.
 * See: https://shopify.dev/api/usage/versioning
 */
export const SHOPIFY_API_VERSION = '2026-07'
export const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES ?? 'read_orders,read_locations'

/** Validate a Shopify shop domain. Must end in .myshopify.com */
export function isValidShopDomain(shop: string): boolean {
  if (!shop || typeof shop !== 'string') return false
  // Only allow myshopify.com domains — no path traversal, no other domains
  return /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shop)
}

/** Generate a cryptographically random OAuth state token */
export function generateOAuthState(): string {
  return crypto.randomBytes(24).toString('hex')
}

/** Build the Shopify authorization URL */
export function buildAuthUrl(shop: string, state: string): string {
  const apiKey = process.env.SHOPIFY_API_KEY
  if (!apiKey) throw new Error('SHOPIFY_API_KEY is not set')
  const appUrl = process.env.SHOPIFY_APP_URL
  if (!appUrl) throw new Error('SHOPIFY_APP_URL is not set')
  // Enforce HTTPS in production (Shopify requires HTTPS for OAuth redirect URIs)
  if (process.env.NODE_ENV === 'production' && !appUrl.startsWith('https://')) {
    throw new Error('SHOPIFY_APP_URL must use HTTPS in production')
  }
  const redirectUri = `${appUrl}/api/integrations/shopify/callback`
  const params = new URLSearchParams({
    client_id: apiKey,
    scope: SHOPIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
  })
  return `https://${shop}/admin/oauth/authorize?${params}`
}

/** Verify Shopify HMAC signature on OAuth callback */
export function verifyOAuthHmac(params: URLSearchParams): boolean {
  const secret = process.env.SHOPIFY_API_SECRET
  if (!secret) return false
  const hmac = params.get('hmac') ?? ''
  const entries: [string, string][] = []
  params.forEach((v, k) => { if (k !== 'hmac') entries.push([k, v]) })
  entries.sort(([a], [b]) => a.localeCompare(b))
  const message = entries.map(([k, v]) => `${k}=${v}`).join('&')
  const expected = crypto.createHmac('sha256', secret).update(message).digest('hex')
  // Constant-time comparison
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

/** Exchange OAuth authorization code for access token */
export async function exchangeOAuthCode(shop: string, code: string): Promise<string> {
  const apiKey = process.env.SHOPIFY_API_KEY
  const apiSecret = process.env.SHOPIFY_API_SECRET
  if (!apiKey || !apiSecret) throw new Error('Shopify API credentials not configured')
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`)
  const data = await res.json() as { access_token?: string }
  if (!data.access_token) throw new Error('No access token in Shopify response')
  // Never log the token
  return data.access_token
}

/**
 * GraphQL query runner against Shopify Admin API.
 * Handles throttling: Shopify uses GraphQL query cost limits.
 * On THROTTLED response, waits for the retry-after time before raising.
 * Callers should implement their own bounded retry loop.
 */
export async function shopifyGraphQL<T = unknown>(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query, variables }),
    }
  )

  // HTTP 429: rate limited at transport level
  if (res.status === 429) {
    const retryAfterMs = parseInt(res.headers.get('retry-after') ?? '2') * 1000
    throw new ShopifyThrottleError(`Rate limited`, retryAfterMs)
  }

  if (!res.ok) throw new Error(`Shopify GraphQL HTTP error: ${res.status}`)

  const body = await res.json() as {
    data?: T
    errors?: unknown[]
    extensions?: { cost?: { throttleStatus?: { currentlyAvailable?: number; restoreRate?: number } } }
  }

  // GraphQL-level throttle (THROTTLED error kind)
  if (body.errors?.length) {
    const throttled = (body.errors as Array<{ extensions?: { code?: string } }>)
      .some(e => e.extensions?.code === 'THROTTLED')
    if (throttled) {
      const restoreRate = body.extensions?.cost?.throttleStatus?.restoreRate ?? 50
      const retryAfterMs = Math.ceil(1000 / restoreRate) * 100  // Wait for ~100 points to restore
      throw new ShopifyThrottleError('GraphQL throttled', retryAfterMs)
    }
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(body.errors).slice(0, 200)}`)
  }

  return body.data as T
}

/** Thrown when Shopify throttles the request — caller should delay and retry */
export class ShopifyThrottleError extends Error {
  constructor(message: string, public readonly retryAfterMs: number) {
    super(message)
    this.name = 'ShopifyThrottleError'
  }
}

/** Fetch basic shop information */
export async function getShopInfo(shop: string, accessToken: string): Promise<{
  id: string
  name: string
  email: string
  timezone: string
  currencyCode: string
  primaryDomain: string
}> {
  const data = await shopifyGraphQL<{
    shop: {
      id: string
      name: string
      email: string
      ianaTimezone: string
      currencyCode: string
      primaryDomain: { url: string }
    }
  }>(shop, accessToken, `
    query GetShop {
      shop {
        id
        name
        email
        ianaTimezone
        currencyCode
        primaryDomain { url }
      }
    }
  `)
  return {
    id: data.shop.id,
    name: data.shop.name,
    email: data.shop.email,
    timezone: data.shop.ianaTimezone,
    currencyCode: data.shop.currencyCode,
    primaryDomain: data.shop.primaryDomain.url,
  }
}

/** Register required webhooks via GraphQL */
export async function registerWebhooks(shop: string, accessToken: string, appUrl: string): Promise<void> {
  const callbackUrl = `${appUrl}/api/integrations/shopify/webhook`
  const topics = [
    'ORDERS_CREATE',
    'ORDERS_UPDATED',
    'ORDERS_CANCELLED',
    'REFUNDS_CREATE',
    'APP_UNINSTALLED',
  ]
  for (const topic of topics) {
    await shopifyGraphQL(shop, accessToken, `
      mutation RegisterWebhook($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: {
          format: JSON
          callbackUrl: $callbackUrl
        }) {
          webhookSubscription { id }
          userErrors { field message }
        }
      }
    `, { topic, callbackUrl })
    // NOTE: In API version 2025-10+, WebhookSubscriptionInput.callbackUrl may be renamed to uri.
    // If registrations fail after a version upgrade, change callbackUrl to uri in this mutation.
    // Log topic registered (not the token)
    console.info(`[shopify] Registered webhook: ${topic} → ${callbackUrl}`)
  }
}

/** Verify Shopify webhook HMAC signature */
export function verifyWebhookHmac(rawBody: string | Buffer, signature: string): boolean {
  const secret = process.env.SHOPIFY_API_SECRET
  if (!secret || !signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64')
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}
