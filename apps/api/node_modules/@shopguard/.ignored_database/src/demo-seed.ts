/**
 * ShopGuard Demo Seed Script
 * Generates synthetic demo data for demonstration purposes.
 * NEVER run against a production database.
 * CLEARLY LABELED as demo data throughout.
 */

import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema.js'
import { nanoid } from 'nanoid'
import bcrypt from 'bcryptjs'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL required')

const client = postgres(DATABASE_URL)
const db = drizzle(client, { schema })

// Seeded random - deterministic
function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

async function seed() {
  console.log('🌱 Seeding demo data...')
  const rand = seededRandom(42)

  // 1. Demo organization
  const orgId = 'demo-org-001'
  const userId = 'demo-user-001'

  await db.insert(schema.organizations).values({
    id: orgId,
    name: 'Demo Electronics Mart',
    slug: 'demo-electronics-mart',
    timezone: 'Asia/Karachi',
    currency: 'PKR',
    locale: 'en',
    businessType: 'electronics',
    isDemo: true,
    isActive: true,
  }).onConflictDoNothing()

  // 2. Demo user
  const passwordHash = await bcrypt.hash('demo1234', 12)
  await db.insert(schema.users).values({
    id: userId,
    email: 'demo@shopguard.app',
    passwordHash,
    name: 'Demo Owner',
    emailVerified: true,
    isActive: true,
  }).onConflictDoNothing()

  await db.insert(schema.memberships).values({
    id: 'demo-mem-001',
    organizationId: orgId,
    userId,
    role: 'OWNER',
    isActive: true,
  }).onConflictDoNothing()

  // 3. Stores
  const stores = [
    { id: 'demo-store-1', name: 'Main Branch', code: 'MB', address: 'Block 5, Clifton, Karachi' },
    { id: 'demo-store-2', name: 'North Outlet', code: 'NO', address: 'Gulshan-e-Iqbal, Karachi' },
    { id: 'demo-store-3', name: 'Mall Counter', code: 'MC', address: 'Dolmen Mall, Karachi' },
  ]

  for (const store of stores) {
    await db.insert(schema.stores).values({
      id: store.id,
      organizationId: orgId,
      name: store.name,
      code: store.code,
      address: store.address,
      isActive: true,
    }).onConflictDoNothing()
  }

  // 4. Registers
  const registers = [
    { id: 'demo-reg-1', storeId: 'demo-store-1', name: 'Counter 1', code: 'C1' },
    { id: 'demo-reg-2', storeId: 'demo-store-1', name: 'Counter 2', code: 'C2' },
    { id: 'demo-reg-3', storeId: 'demo-store-2', name: 'Main Till', code: 'MT' },
    { id: 'demo-reg-4', storeId: 'demo-store-3', name: 'Mall Register', code: 'MR' },
  ]

  for (const reg of registers) {
    await db.insert(schema.registers).values({
      id: reg.id,
      organizationId: orgId,
      storeId: reg.storeId,
      name: reg.name,
      code: reg.code,
      isActive: true,
    }).onConflictDoNothing()
  }

  // 5. Employees
  const employees = [
    { id: 'demo-emp-1', name: 'Ahmed Khan', storeId: 'demo-store-1', role: 'Cashier' },
    { id: 'demo-emp-2', name: 'Sara Ali', storeId: 'demo-store-1', role: 'Senior Cashier' },
    { id: 'demo-emp-3', name: 'Bilal Rashid', storeId: 'demo-store-1', role: 'Cashier' },
    { id: 'demo-emp-4', name: 'Fatima Malik', storeId: 'demo-store-2', role: 'Supervisor' },
    { id: 'demo-emp-5', name: 'Hassan Mirza', storeId: 'demo-store-2', role: 'Cashier' },
    { id: 'demo-emp-6', name: 'Zara Sheikh', storeId: 'demo-store-3', role: 'Cashier' },
    { id: 'demo-emp-7', name: 'Usman Tariq', storeId: 'demo-store-3', role: 'Cashier' },
  ]

  for (const emp of employees) {
    await db.insert(schema.employees).values({
      id: emp.id,
      organizationId: orgId,
      name: emp.name,
      role: emp.role,
      isActive: true,
    }).onConflictDoNothing()
  }

  // 6. Generate 60 days of transactions
  const now = new Date()
  const startDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
  const paymentMethods = ['cash', 'cash', 'cash', 'card', 'card', 'mobile']
  let txBatch: typeof schema.transactions.$inferInsert[] = []
  let txNum = 1000

  const storeData = [
    { store: stores[0], storeRegisters: registers.slice(0, 2), storeEmployees: employees.slice(0, 3) },
    { store: stores[1], storeRegisters: registers.slice(2, 3), storeEmployees: employees.slice(3, 5) },
    { store: stores[2], storeRegisters: registers.slice(3, 4), storeEmployees: employees.slice(5, 7) },
  ]

  for (let day = 0; day < 60; day++) {
    const date = new Date(startDate.getTime() + day * 24 * 60 * 60 * 1000)
    const dow = date.getDay()
    const isWeekend = dow === 5 || dow === 6
    const volumeMultiplier = isWeekend ? 1.5 : 1.0

    for (const { store, storeRegisters, storeEmployees } of storeData) {
      const dailyVolume = Math.floor((60 + rand() * 50) * volumeMultiplier)

      for (let t = 0; t < dailyVolume; t++) {
        const hour = Math.floor(8 + rand() * 13)
        const minute = Math.floor(rand() * 60)
        const ts = new Date(date)
        ts.setHours(hour, minute, Math.floor(rand() * 60))

        const emp = storeEmployees[Math.floor(rand() * storeEmployees.length)]
        const reg = storeRegisters[Math.floor(rand() * storeRegisters.length)]
        const pm = paymentMethods[Math.floor(rand() * paymentMethods.length)]

        const grossAmount = Math.round(200 + rand() * 4800)
        const discountPct = rand() < 0.15 ? Math.round(rand() * 15) : 0
        const discountAmount = Math.round(grossAmount * discountPct / 100)
        const netAmount = grossAmount - discountAmount

        // Bilal (demo-emp-3) has elevated void rate in last 7 days (ANOMALY 1)
        const isRecentBilal = emp.id === 'demo-emp-3' && day >= 53
        const isVoid = isRecentBilal ? rand() < 0.14 : rand() < 0.02
        const isRefund = !isVoid && rand() < 0.015
        const isNoSale = !isVoid && !isRefund && rand() < 0.01

        txBatch.push({
          id: `demo-tx-${txNum++}`,
          organizationId: orgId,
          storeId: store.id,
          registerId: reg.id,
          employeeId: emp.id,
          externalTransactionId: `TX${txNum}`,
          timestamp: ts,
          currency: 'PKR',
          grossAmount: grossAmount.toFixed(2),
          discountAmount: discountAmount.toFixed(2),
          refundAmount: (isRefund ? netAmount : 0).toFixed(2),
          netAmount: (isVoid ? 0 : isRefund ? -netAmount : netAmount).toFixed(2),
          paymentMethod: pm,
          transactionStatus: isVoid ? 'VOIDED' : isRefund ? 'REFUNDED' : 'COMPLETED',
          itemCount: Math.floor(1 + rand() * 8),
          isVoid,
          isRefund,
          isNoSale,
          hasPriceOverride: rand() < 0.03,
          discountPercent: discountPct > 0 ? discountPct.toFixed(2) : null,
          source: 'demo',
          isDemo: true,
        })

        // Void-after-cash injection (ANOMALY 2) - last 3 days, store 1
        if (!isVoid && pm === 'cash' && day >= 57 && rand() < 0.08) {
          const voidTs = new Date(ts.getTime() + 20000 + Math.floor(rand() * 40000))
          txBatch.push({
            id: `demo-tx-${txNum++}`,
            organizationId: orgId,
            storeId: store.id,
            registerId: reg.id,
            employeeId: emp.id,
            externalTransactionId: `TX${txNum}`,
            timestamp: voidTs,
            currency: 'PKR',
            grossAmount: grossAmount.toFixed(2),
            discountAmount: '0',
            refundAmount: '0',
            netAmount: '0',
            paymentMethod: pm,
            transactionStatus: 'VOIDED',
            isVoid: true,
            isRefund: false,
            isNoSale: false,
            hasPriceOverride: false,
            discountPercent: null,
            source: 'demo',
            isDemo: true,
          })
          txNum++
        }

        // Batch insert every 500
        if (txBatch.length >= 500) {
          await db.insert(schema.transactions).values(txBatch).onConflictDoNothing()
          txBatch = []
          process.stdout.write('.')
        }
      }
    }
  }

  // Insert remaining
  if (txBatch.length > 0) {
    await db.insert(schema.transactions).values(txBatch).onConflictDoNothing()
  }

  console.log('\n✅ Demo seed complete!')
  console.log('   Login: demo@shopguard.app / demo1234')
  await client.end()
}

seed().catch(e => { console.error(e); process.exit(1) })
