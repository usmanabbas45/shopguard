import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '@shopguard/database'

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL not configured')

    // Serverless environments (Vercel) create many concurrent instances.
    // Use max:1 to avoid exhausting Neon's free-tier connection limit.
    // For Docker/self-hosted, DATABASE_MAX_CONNECTIONS can be set higher.
    const maxConnections = parseInt(process.env.DATABASE_MAX_CONNECTIONS ?? '1', 10)

    const client = postgres(url, {
      max: maxConnections,
      // Neon free tier auto-suspends; give extra time for cold start
      connect_timeout: 30,
      idle_timeout: 20,
    })
    _db = drizzle(client, { schema })
  }
  return _db
}
