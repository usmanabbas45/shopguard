/**
 * ShopGuard Next.js Middleware
 */
import { NextRequest, NextResponse } from 'next/server'

const PROTECTED_PREFIXES = [
  '/dashboard','/incidents','/stores','/employees','/cash',
  '/import','/reports','/settings','/admin','/onboarding',
]

const PROTECTED_API_PREFIXES = [
  '/api/dashboard','/api/incidents','/api/stores','/api/employees',
  '/api/cash','/api/imports','/api/admin','/api/reports',
  '/api/settings','/api/billing',
  '/api/integrations/shopify/install',
  '/api/integrations/shopify',
  '/api/integrations/shopify/sync',
]

const PUBLIC_ROUTES = ['/','/login','/signup','/api/auth/login','/api/auth/signup',
  '/api/health','/api/webhooks','/api/ingest',
  '/api/integrations/shopify/webhook','/api/integrations/shopify/callback']

function isProtected(pathname: string): boolean {
  if (PUBLIC_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))) return false
  if (pathname.startsWith('/api/webhooks')) return false
  if (PROTECTED_PREFIXES.some(p => pathname.startsWith(p))) return true
  if (PROTECTED_API_PREFIXES.some(p => pathname.startsWith(p))) return true
  return false
}

function addSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.headers.set('X-XSS-Protection', '1; mode=block')
  if (process.env.NODE_ENV === 'production') {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  res.headers.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://api.lemonsqueezy.com https://*.myshopify.com",
    "frame-src 'self' https://app.lemonsqueezy.com",
    "frame-ancestors 'none'",
  ].join('; '))
  return res
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX_AUTH = 10
const RATE_LIMIT_MAX_API = 200

function checkRateLimit(ip: string, limit: number): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    if (rateLimitMap.size > 500) {
      for (const [k, e] of rateLimitMap) {
        if (e.resetAt < now) { rateLimitMap.delete(k); if (rateLimitMap.size < 400) break }
      }
    }
    return true
  }
  entry.count++
  return entry.count <= limit
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown'

  if (pathname.startsWith('/api/auth/')) {
    if (!checkRateLimit(`auth:${ip}`, RATE_LIMIT_MAX_AUTH)) {
      return new NextResponse(JSON.stringify({ error: 'Too many requests.' }), {
        status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      })
    }
  }

  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/')) {
    if (!checkRateLimit(`api:${ip}`, RATE_LIMIT_MAX_API)) {
      return new NextResponse(JSON.stringify({ error: 'Too many requests.' }), {
        status: 429, headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  if (isProtected(pathname)) {
    const sessionToken = req.cookies.get('sg_session')?.value
    if (!sessionToken) {
      if (pathname.startsWith('/api/')) {
        return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { 'Content-Type': 'application/json' },
        })
      }
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  if ((pathname === '/login' || pathname === '/signup') && req.cookies.get('sg_session')) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  const res = NextResponse.next()
  addSecurityHeaders(res)
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
