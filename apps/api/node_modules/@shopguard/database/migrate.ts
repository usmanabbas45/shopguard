/**
 * Run database migrations against the target DATABASE_URL.
 * Works with Neon, local PostgreSQL, or any postgres-compatible DB.
 *
 * Usage:
 *   DATABASE_URL=<url> tsx migrate.ts
 */

import postgres from 'postgres'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const sql = postgres(DATABASE_URL, { max: 1 })

async function migrate() {
  console.log('Running migrations...')

  const migrationFile = join(__dirname, 'migrations', '0001_initial.sql')
  const migration = readFileSync(migrationFile, 'utf-8')

  // Split on statement terminators and run each statement
  const statements = migration
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'))

  console.log(`Found ${statements.length} SQL statements`)

  for (const statement of statements) {
    try {
      await sql.unsafe(statement + ';')
    } catch (err: unknown) {
      // Skip "already exists" errors — idempotent migrations
      const msg = err instanceof Error ? err.message : String(err)
      if (
        msg.includes('already exists') ||
        msg.includes('duplicate') ||
        msg.includes('AlreadyExists')
      ) {
        // Ignore — table/index already created
      } else {
        console.error('Migration error:', msg)
        console.error('Statement:', statement.slice(0, 100))
        throw err
      }
    }
  }

  console.log('✓ Migrations complete')
  await sql.end()
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
