import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '@shopguard/database'

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL not configured')

    const maxConnections = parseInt(process.env.DATABASE_MAX_CONNECTIONS ?? '1', 10)

    const client = postgres(url, {
      max: maxConnections,
      // Fail fast if Neon is suspended — don't hang for 300s
      connect_timeout: 10,
      idle_timeout: 10,
      ssl: { rejectUnauthorized: false },
    })
    _db = drizzle(client, { schema })
  }
  return _db
}
