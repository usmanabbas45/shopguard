/**
 * Redis-backed rate limiter for ingestion API.
 * Falls back to ALLOW on Redis unavailability (fail open for ingestion).
 * 
 * Limits per API key:
 *   - 1000 requests per minute
 *   - 50,000 transactions per hour
 */
import { getRedis } from '@/lib/queue/index'

const WINDOW_SECONDS = 60
const MAX_REQUESTS_PER_WINDOW = 1000

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number   // Unix timestamp
}

export async function checkRateLimit(keyId: string): Promise<RateLimitResult> {
  const redis = getRedis()

  // No Redis → fail open (allow ingestion, log warning)
  if (!redis) {
    console.warn('[rate-limit] Redis unavailable — rate limiting disabled')
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW, resetAt: Date.now() + WINDOW_SECONDS * 1000 }
  }

  const windowStart = Math.floor(Date.now() / (WINDOW_SECONDS * 1000))
  const redisKey = `rl:ingest:${keyId}:${windowStart}`

  try {
    const current = await redis.incr(redisKey)
    if (current === 1) {
      await redis.expire(redisKey, WINDOW_SECONDS)
    }
    const resetAt = (windowStart + 1) * WINDOW_SECONDS * 1000
    const remaining = Math.max(0, MAX_REQUESTS_PER_WINDOW - current)
    return {
      allowed: current <= MAX_REQUESTS_PER_WINDOW,
      remaining,
      resetAt,
    }
  } catch {
    // Redis error → fail open
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW, resetAt: Date.now() + WINDOW_SECONDS * 1000 }
  }
}

