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
      connect_timeout: 15,
      idle_timeout: 20,
      ssl: 'require',
      prepare: false,
      connection: {
        application_name: 'shopguard-web',
      },
    })
    _db = drizzle(client, { schema })
  }
  return _db
}
