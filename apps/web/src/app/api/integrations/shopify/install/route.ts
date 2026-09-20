/**
 * GET /api/integrations/shopify/install?shop=mystore.myshopify.com
 * Shopify OAuth step 1: validate shop, generate state, redirect to Shopify auth.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isValidShopDomain, generateOAuthState, buildAuthUrl } from '@/lib/shopify/client'
import { getRedis } from '@/lib/queue/index'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['OWNER', 'ADMIN'].includes(session.role)) return NextResponse.json({ error: 'Only OWNER or ADMIN can connect Shopify' }, { status: 403 })
  if (session.isDemo) return NextResponse.json({ error: 'Demo organizations cannot connect Shopify' }, { status: 400 })

  const shop = req.nextUrl.searchParams.get('shop')?.trim().toLowerCase() ?? ''
  if (!isValidShopDomain(shop)) return NextResponse.json({ error: 'Invalid Shopify shop domain (must end in .myshopify.com)' }, { status: 400 })

  if (!process.env.SHOPIFY_API_KEY) return NextResponse.json({ error: 'Shopify integration not configured (SHOPIFY_API_KEY not set)' }, { status: 503 })

  const state = generateOAuthState()
  const redis = getRedis()
  if (!redis) return NextResponse.json({ error: 'OAuth state storage requires Redis (REDIS_URL not configured)' }, { status: 503 })

  await redis.setex(`shopify:oauth:state:${state}`, 600, JSON.stringify({
    organizationId: session.organizationId,
    userId: session.id,
    shop,
  }))

  return NextResponse.redirect(buildAuthUrl(shop, state))
}

