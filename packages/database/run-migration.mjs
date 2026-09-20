import postgres from './node_modules/postgres/src/index.js'

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 })

console.log('Creating tables...')

try {
  // Enums
  await sql.unsafe(`DO $$ BEGIN
    CREATE TYPE role AS ENUM ('OWNER','ADMIN','MANAGER','INVESTIGATOR','VIEWER');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)
  
  await sql.unsafe(`DO $$ BEGIN
    CREATE TYPE severity AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)
  
  await sql.unsafe(`DO $$ BEGIN
    CREATE TYPE risk_level AS ENUM ('LOW','MEDIUM','HIGH');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)
  
  await sql.unsafe(`DO $$ BEGIN
    CREATE TYPE incident_status AS ENUM ('OPEN','UNDER_REVIEW','RESOLVED','DISMISSED');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)
  
  await sql.unsafe(`DO $$ BEGIN
    CREATE TYPE review_label AS ENUM ('VALID_INCIDENT','FALSE_POSITIVE','NEEDS_INVESTIGATION','NOT_ENOUGH_EVIDENCE');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)
  
  await sql.unsafe(`DO $$ BEGIN
    CREATE TYPE tx_status AS ENUM ('COMPLETED','VOIDED','REFUNDED','PARTIAL_REFUND','PENDING','CANCELLED');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)
  
  await sql.unsafe(`DO $$ BEGIN
    CREATE TYPE import_status AS ENUM ('PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)
  
  await sql.unsafe(`DO $$ BEGIN
    CREATE TYPE notif_channel AS ENUM ('EMAIL','WHATSAPP','SMS','IN_APP');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)
  
  await sql.unsafe(`DO $$ BEGIN
    CREATE TYPE notif_type AS ENUM ('INCIDENT_CREATED','INCIDENT_FOLLOWUP','INCIDENT_ESCALATION','DAILY_REPORT','SYSTEM_ALERT');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)
  
  await sql.unsafe(`DO $$ BEGIN
    CREATE TYPE notif_status AS ENUM ('PENDING','SENT','DELIVERED','FAILED','SKIPPED');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)
  
  await sql.unsafe(`DO $$ BEGIN
    CREATE TYPE model_status AS ENUM ('CANDIDATE','PRODUCTION','RETIRED','FAILED');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)
  
  await sql.unsafe(`DO $$ BEGIN
    CREATE TYPE baseline_conf AS ENUM ('LOW','MEDIUM','HIGH');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)
  
  await sql.unsafe(`DO $$ BEGIN
    CREATE TYPE subscription_plan AS ENUM ('TRIAL','STARTER','GROWTH','MULTI_LOCATION','ENTERPRISE');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)
  
  await sql.unsafe(`DO $$ BEGIN
    CREATE TYPE subscription_status AS ENUM ('ACTIVE','TRIALING','PAST_DUE','CANCELLED','EXPIRED');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`)

  console.log('✓ Enums created')

  // Read and run the full SQL file but skip the enum lines
  const { readFileSync } = await import('fs')
  let fullSql = readFileSync('./migrations/0001_initial.sql', 'utf-8')
  
  // Remove all lines starting with CREATE TYPE (we already did those above)
  const lines = fullSql.split('\n')
  const filtered = lines.filter(l => !l.trim().startsWith('CREATE TYPE'))
  const tablesSql = filtered.join('\n')
  
  // Split by semicolon and run each statement
  const statements = tablesSql.split(';').map(s => s.trim()).filter(s => s.length > 3)
  
  let done = 0
  for (const stmt of statements) {
    try {
      await sql.unsafe(stmt)
      done++
    } catch(e) {
      if (e.code === '42P07' || e.code === '42710' || e.message.includes('already exists')) {
        // Already exists - skip
      } else {
        console.log('Warning:', e.message.slice(0, 80))
      }
    }
  }
  
  console.log(`✓ ${done} statements executed`)
  console.log('✓ Migration complete!')

} catch(e) {
  console.error('Fatal error:', e.message)
}

await sql.end()
