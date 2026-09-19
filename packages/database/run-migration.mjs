import postgres from './node_modules/postgres/src/index.js'

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 })
console.log('Creating enums...')

const enums = [
  `DO $$ BEGIN CREATE TYPE role AS ENUM ('OWNER','ADMIN','MANAGER','INVESTIGATOR','VIEWER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE severity AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE risk_level AS ENUM ('LOW','MEDIUM','HIGH'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE incident_status AS ENUM ('OPEN','UNDER_REVIEW','RESOLVED','DISMISSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE review_label AS ENUM ('VALID_INCIDENT','FALSE_POSITIVE','NEEDS_INVESTIGATION','NOT_ENOUGH_EVIDENCE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE tx_status AS ENUM ('COMPLETED','VOIDED','REFUNDED','PARTIAL_REFUND','PENDING','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE import_status AS ENUM ('PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE notif_channel AS ENUM ('EMAIL','WHATSAPP','SMS','IN_APP'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE notif_type AS ENUM ('INCIDENT_CREATED','INCIDENT_FOLLOWUP','INCIDENT_ESCALATION','DAILY_REPORT','SYSTEM_ALERT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE notif_status AS ENUM ('PENDING','SENT','DELIVERED','FAILED','SKIPPED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE model_status AS ENUM ('CANDIDATE','PRODUCTION','RETIRED','FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE baseline_conf AS ENUM ('LOW','MEDIUM','HIGH'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE subscription_plan AS ENUM ('TRIAL','STARTER','GROWTH','MULTI_LOCATION','ENTERPRISE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE subscription_status AS ENUM ('ACTIVE','TRIALING','PAST_DUE','CANCELLED','EXPIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
]

for (const e of enums) await sql.unsafe(e)
console.log('✓ Enums done')

const { readFileSync } = await import('fs')
let fullSql = readFileSync('./migrations/0001_initial.sql', 'utf-8')
const stmts = fullSql.split(';').map(s => s.trim()).filter(s => s.length > 5 && !s.startsWith('CREATE TYPE'))

let ok = 0, skip = 0
for (const s of stmts) {
  try { await sql.unsafe(s); ok++ }
  catch(e) {
    if (['42P07','42710','42701'].includes(e.code)) skip++
    else console.log('WARN:', e.code, e.message.slice(0,60))
  }
}
console.log(`✓ Tables: ${ok} created, ${skip} skipped (already existed)`)
console.log('✓ Migration complete!')
await sql.end()
