import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession, canAccess } from '@/lib/auth'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (session.isDemo) {
      return NextResponse.json({ stores: [
        { id: 'demo-store-1', name: 'Main Branch', code: 'MB', address: 'Block 5, Clifton, Karachi', registers: 2, employees: 3, txCount: 4201, avgTx: 1340, voidRate: 0.028, incidents: 3, todaySales: 218000, cashVariance: -1400, riskLevel: 'HIGH' },
        { id: 'demo-store-2', name: 'North Outlet', code: 'NO', address: 'Gulshan-e-Iqbal, Karachi', registers: 1, employees: 2, txCount: 3108, avgTx: 1560, voidRate: 0.022, incidents: 2, todaySales: 163000, cashVariance: 200, riskLevel: 'HIGH' },
        { id: 'demo-store-3', name: 'Mall Counter', code: 'MC', address: 'Dolmen Mall, Karachi', registers: 1, employees: 2, txCount: 2541, avgTx: 1820, voidRate: 0.019, incidents: 2, todaySales: 106250, cashVariance: 0, riskLevel: 'MEDIUM' },
      ]})
    }

    const db = (await import('@/lib/db')).getDb()
    const { stores, storeBaselines, incidents, registers, employees } = await import('@shopguard/database')
    const { eq, and, gte, sql } = await import('drizzle-orm')
    const orgId = session.organizationId
    const today = new Date(); today.setHours(0, 0, 0, 0)

    const storeRows = await db.select({ id: stores.id, name: stores.name, code: stores.code, address: stores.address }).from(stores).where(and(eq(stores.organizationId, orgId), eq(stores.isActive, true)))

    const { transactions } = await import('@shopguard/database')
    const result = await Promise.all(storeRows.map(async store => {
      const [baseline] = await db.select().from(storeBaselines).where(and(eq(storeBaselines.organizationId, orgId), eq(storeBaselines.storeId, store.id), eq(storeBaselines.period, 'rolling_30d'))).limit(1)
      const [todayStats] = await db.select({ sales: sql<number>`coalesce(sum(case when not is_void and not is_refund then net_amount::numeric else 0 end),0)` }).from(transactions).where(and(eq(transactions.organizationId, orgId), eq(transactions.storeId, store.id), gte(transactions.timestamp, today), eq(transactions.isDemo, false)))
      const [incCount] = await db.select({ count: sql<number>`count(*)` }).from(incidents).where(and(eq(incidents.organizationId, orgId), eq(incidents.storeId, store.id), eq(incidents.status, 'OPEN'), eq(incidents.isDemo, false)))
      const [regCount] = await db.select({ count: sql<number>`count(*)` }).from(registers).where(and(eq(registers.organizationId, orgId), eq(registers.storeId, store.id)))
      const [empCount] = await db.select({ count: sql<number>`count(*)` }).from(employees).where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true)))
      const openIncidents = Number(incCount?.count ?? 0)
      const voidRate = baseline ? Number(baseline.voidRate ?? 0) : 0
      const riskLevel = openIncidents >= 3 || voidRate > 0.04 ? 'HIGH' : openIncidents > 0 || voidRate > 0.02 ? 'MEDIUM' : 'LOW'
      return { id: store.id, name: store.name, code: store.code, address: store.address, registers: Number(regCount?.count ?? 0), employees: Number(empCount?.count ?? 0), txCount: baseline?.txCount ?? 0, avgTx: baseline?.avgAmount ? Number(baseline.avgAmount) : null, voidRate, incidents: openIncidents, todaySales: Number(todayStats?.sales ?? 0), cashVariance: null, riskLevel }
    }))

    return NextResponse.json({ stores: result })
  } catch (err) {
    console.error('[stores]', err)
    return NextResponse.json({ error: 'Failed to load stores' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccess(session.role, 'MANAGER')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (session.isDemo) return NextResponse.json({ error: 'Cannot create stores in demo mode' }, { status: 400 })

    const schema = z.object({ name: z.string().min(1).max(200), code: z.string().max(50).optional(), address: z.string().max(500).optional() })
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })

    const db = (await import('@/lib/db')).getDb()
    const { stores, auditLogs } = await import('@shopguard/database')
    const { nanoid } = await import('nanoid')

    const storeId = nanoid()
    await db.insert(stores).values({ id: storeId, organizationId: session.organizationId, name: parsed.data.name, code: parsed.data.code ?? null, address: parsed.data.address ?? null, isActive: true })
    await db.insert(auditLogs).values({ id: nanoid(), organizationId: session.organizationId, userId: session.id, action: 'store_created', entity: 'store', entityId: storeId, metadata: { name: parsed.data.name } })

    return NextResponse.json({ success: true, storeId })
  } catch (err) {
    return NextResponse.json({ error: 'Failed to create store' }, { status: 500 })
  }
}
