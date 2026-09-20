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
      connect_timeout: 10,
      idle_timeout: 10,
      max_lifetime: 60 * 10,
      ssl: 'require',
      prepare: false,
    })
    _db = drizzle(client, { schema })
  }
  return _db
}
