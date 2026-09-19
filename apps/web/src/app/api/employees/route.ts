import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const db = (await import('@/lib/db')).getDb()
    const { employees, employeeBaselines, incidents } = await import('@shopguard/database')
    const { eq, and, sql, desc } = await import('drizzle-orm')

    const orgId = session.organizationId

    if (session.isDemo) {
      // Return demo employees from demo-data
      const { generateDemoIncidents } = await import('@/lib/demo-data')
      const demoIncidents = generateDemoIncidents()
      return NextResponse.json({
        employees: [
          { id: 'demo-emp-1', name: 'Ahmed Khan', role: 'Cashier', storeId: 'demo-store-1', storeName: 'Main Branch', txCount: 1842, avgAmount: 1250, voidRate: 0.021, refundRate: 0.012, discountRate: 0.08, incidents: 0, baselineConf: 'HIGH', riskLevel: 'LOW' },
          { id: 'demo-emp-2', name: 'Sara Ali', role: 'Senior Cashier', storeId: 'demo-store-1', storeName: 'Main Branch', txCount: 2103, avgAmount: 1480, voidRate: 0.018, refundRate: 0.009, discountRate: 0.06, incidents: 0, baselineConf: 'HIGH', riskLevel: 'LOW' },
          { id: 'demo-emp-3', name: 'Bilal Rashid', role: 'Cashier', storeId: 'demo-store-1', storeName: 'Main Branch', txCount: 1204, avgAmount: 1310, voidRate: 0.142, refundRate: 0.011, discountRate: 0.09, incidents: 2, baselineConf: 'MEDIUM', riskLevel: 'HIGH' },
          { id: 'demo-emp-4', name: 'Fatima Malik', role: 'Supervisor', storeId: 'demo-store-2', storeName: 'North Outlet', txCount: 976, avgAmount: 2100, voidRate: 0.022, refundRate: 0.015, discountRate: 0.07, incidents: 1, baselineConf: 'MEDIUM', riskLevel: 'HIGH' },
          { id: 'demo-emp-5', name: 'Hassan Mirza', role: 'Cashier', storeId: 'demo-store-2', storeName: 'North Outlet', txCount: 1456, avgAmount: 980, voidRate: 0.024, refundRate: 0.028, discountRate: 0.11, incidents: 1, baselineConf: 'HIGH', riskLevel: 'MEDIUM' },
          { id: 'demo-emp-6', name: 'Zara Sheikh', role: 'Cashier', storeId: 'demo-store-3', storeName: 'Mall Counter', txCount: 834, avgAmount: 1820, voidRate: 0.019, refundRate: 0.007, discountRate: 0.18, incidents: 1, baselineConf: 'MEDIUM', riskLevel: 'MEDIUM' },
          { id: 'demo-emp-7', name: 'Usman Tariq', role: 'Cashier', storeId: 'demo-store-3', storeName: 'Mall Counter', txCount: 712, avgAmount: 1540, voidRate: 0.023, refundRate: 0.014, discountRate: 0.08, incidents: 0, baselineConf: 'LOW', riskLevel: 'LOW' },
        ]
      })
    }

    // Real employees with baseline data
    const empRows = await db
      .select({
        id: employees.id,
        name: employees.name,
        role: employees.role,
        isActive: employees.isActive,
        createdAt: employees.createdAt,
      })
      .from(employees)
      .where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true)))

    // Get baselines for each employee
    const result = await Promise.all(empRows.map(async (emp) => {
      const [baseline] = await db
        .select()
        .from(employeeBaselines)
        .where(and(
          eq(employeeBaselines.organizationId, orgId),
          eq(employeeBaselines.employeeId, emp.id),
          eq(employeeBaselines.period, 'rolling_30d')
        ))
        .limit(1)

      const [incidentCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(incidents)
        .where(and(
          eq(incidents.organizationId, orgId),
          eq(incidents.employeeId, emp.id),
          eq(incidents.status, 'OPEN'),
          eq(incidents.isDemo, false)
        ))

      const voidRate = baseline ? Number(baseline.voidRate ?? 0) : null
      const incidents_ = Number(incidentCount?.count ?? 0)

      // Determine risk level
      let riskLevel = 'LOW'
      if (voidRate !== null && voidRate > 0.05) riskLevel = 'HIGH'
      else if (incidents_ > 0) riskLevel = 'MEDIUM'

      return {
        id: emp.id,
        name: emp.name,
        role: emp.role,
        txCount: baseline?.txCount ?? 0,
        avgAmount: baseline?.avgAmount ? Number(baseline.avgAmount) : null,
        voidRate,
        refundRate: baseline ? Number(baseline.refundRate ?? 0) : null,
        discountRate: baseline ? Number(baseline.discountRate ?? 0) : null,
        avgDiscountPct: baseline ? Number(baseline.avgDiscountPct ?? 0) : null,
        baselineConf: baseline?.confidence ?? 'LOW',
        incidents: incidents_,
        riskLevel,
      }
    }))

    return NextResponse.json({ employees: result })
  } catch (err) {
    console.error('[employees]', err)
    return NextResponse.json({ error: 'Failed to load employees' }, { status: 500 })
  }
}
