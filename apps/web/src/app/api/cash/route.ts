import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (session.isDemo) {
      return NextResponse.json({ sessions: [
        { id: 'cs-1', date: 'Today', store: 'Main Branch', register: 'Counter 1', employee: 'Ahmed Khan', expected: 57120, counted: 57080, variance: -40, isReconciled: true },
        { id: 'cs-2', date: 'Today', store: 'Main Branch', register: 'Counter 2', employee: 'Bilal Rashid', expected: 40650, counted: 39250, variance: -1400, isReconciled: true },
        { id: 'cs-3', date: 'Today', store: 'North Outlet', register: 'Main Till', employee: 'Hassan Mirza', expected: 65600, counted: 65800, variance: 200, isReconciled: true },
      ]})
    }

    const db = (await import('@/lib/db')).getDb()
    const { cashSessions, stores, registers, employees } = await import('@shopguard/database')
    const { eq, and, desc } = await import('drizzle-orm')

    const orgId = session.organizationId

    const sessions = await db
      .select({
        id: cashSessions.id,
        date: cashSessions.date,
        openingCash: cashSessions.openingCash,
        cashSales: cashSessions.cashSales,
        cashRefunds: cashSessions.cashRefunds,
        expectedCash: cashSessions.expectedCash,
        countedCash: cashSessions.countedCash,
        variance: cashSessions.variance,
        isReconciled: cashSessions.isReconciled,
        storeName: stores.name,
        registerName: registers.name,
        employeeName: employees.name,
      })
      .from(cashSessions)
      .leftJoin(stores, eq(stores.id, cashSessions.storeId))
      .leftJoin(registers, eq(registers.id, cashSessions.registerId))
      .leftJoin(employees, eq(employees.id, cashSessions.employeeId))
      .where(and(eq(cashSessions.organizationId, orgId), eq(cashSessions.isDemo, false)))
      .orderBy(desc(cashSessions.date))
      .limit(50)

    return NextResponse.json({ sessions })
  } catch (err) {
    console.error('[cash]', err)
    return NextResponse.json({ error: 'Failed to load cash sessions' }, { status: 500 })
  }
}
