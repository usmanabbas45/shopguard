/**
 * ShopGuard Next.js Middleware
 *
 * Runs on every request before the page/API handler.
 * Handles:
 * - Security headers (CSP, HSTS, X-Frame-Options, etc.)
 * - Auth route protection (redirect to /login if not authenticated)
 * - Best-effort in-process rate limiting (see note below)
 * - CORS for API routes
 *
 * Rate limiting note: the in-memory Map is best-effort only. For multi-instance
 * production deployments, replace with @upstash/ratelimit (Redis-backed).
 */

import { NextRequest, NextResponse } from 'next/server'

// Routes that require authentication
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/incidents',
  '/stores',
  '/employees',
  '/cash',
  '/import',
  '/reports',
  '/settings',
  '/admin',
  '/onboarding',
]

// API routes that require authentication (not webhooks which use their own auth)
const PROTECTED_API_PREFIXES = [
  '/api/dashboard',
  '/api/incidents',
  '/api/stores',
  '/api/employees',
  '/api/cash',
  '/api/imports',
  '/api/admin',
  // NOTE: /api/analysis is intentionally NOT here — it handles its own auth
  //       (user session OR worker key header), so middleware must not block it.
  '/api/reports',
]

// Public routes
const PUBLIC_ROUTES = ['/', '/login', '/signup', '/api/auth/login', '/api/auth/signup', '/api/health', '/api/webhooks']

function isProtected(pathname: string): boolean {
  if (PUBLIC_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))) return false
  if (pathname.startsWith('/api/webhooks')) return false
  if (PROTECTED_PREFIXES.some(p => pathname.startsWith(p))) return true
  if (PROTECTED_API_PREFIXES.some(p => pathname.startsWith(p))) return true
  return false
}

function addSecurityHeaders(res: NextResponse): NextResponse {
  // Prevent clickjacking
  res.headers.set('X-Frame-Options', 'DENY')
  // Prevent MIME type sniffing
  res.headers.set('X-Content-Type-Options', 'nosniff')
  // Referrer policy
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  // Permissions policy
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  // XSS Protection (legacy browsers)
  res.headers.set('X-XSS-Protection', '1; mode=block')
  // HSTS (only in production with HTTPS)
  if (process.env.NODE_ENV === 'production') {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  // Content Security Policy
  res.headers.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js requires unsafe-eval in dev
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '))
  return res
}

// Simple in-memory rate limiter (per IP, resets every minute)
// In production, use Redis-backed rate limiting
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60 * 1000  // 1 minute
const RATE_LIMIT_MAX_AUTH = 10          // 10 auth attempts per minute
const RATE_LIMIT_MAX_API = 200          // 200 API calls per minute

function checkRateLimit(ip: string, limit: number): boolean {
  const now = Date.now()
  const key = ip
  const entry = rateLimitMap.get(key)

  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    // Inline cleanup: remove a few expired entries to bound map size at Edge
    if (rateLimitMap.size > 500) {
      for (const [k, e] of rateLimitMap) {
        if (e.resetAt < now) { rateLimitMap.delete(k); if (rateLimitMap.size < 400) break }
      }
    }
    return true
  }

  entry.count++
  if (entry.count > limit) return false
  return true
}

// Note: rate limit map cleanup happens inline (setInterval not available at Edge)

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown'

  // Rate limit auth endpoints aggressively
  if (pathname.startsWith('/api/auth/')) {
    if (!checkRateLimit(`auth:${ip}`, RATE_LIMIT_MAX_AUTH)) {
      return new NextResponse(JSON.stringify({ error: 'Too many requests. Please try again.' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
        },
      })
    }
  }

  // Rate limit API endpoints
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/')) {
    if (!checkRateLimit(`api:${ip}`, RATE_LIMIT_MAX_API)) {
      return new NextResponse(JSON.stringify({ error: 'Too many requests.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  // Auth check for protected routes
  if (isProtected(pathname)) {
    const sessionToken = req.cookies.get('sg_session')?.value
    if (!sessionToken) {
      // Redirect pages to login; return 401 for API
      if (pathname.startsWith('/api/')) {
        return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
    // Note: full session validation happens in getSession() inside each handler
    // Middleware just checks for cookie presence for performance
  }

  // Redirect authenticated users away from auth pages
  if ((pathname === '/login' || pathname === '/signup') && req.cookies.get('sg_session')) {
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  const res = NextResponse.next()
  addSecurityHeaders(res)
  return res
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
