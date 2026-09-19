import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateDemoIncidents } from '@/lib/demo-data'

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') ?? '1')
    const pageSize = Math.min(parseInt(searchParams.get('pageSize') ?? '20'), 100)
    const status = searchParams.get('status')
    const severity = searchParams.get('severity')
    const storeId = searchParams.get('storeId')

    if (session.isDemo) {
      let items = generateDemoIncidents()
      if (status) items = items.filter(i => i.status === status)
      if (severity) items = items.filter(i => i.severity === severity)
      const total = items.length
      const start = (page - 1) * pageSize
      return NextResponse.json({
        items: items.slice(start, start + pageSize),
        total,
        page,
        pageSize,
        hasNext: start + pageSize < total,
      })
    }

    const db = (await import('@/lib/db')).getDb()
    const { incidents, employees, stores } = await import('@shopguard/database')
    const { eq, and, desc, sql } = await import('drizzle-orm')

    const conditions = [eq(incidents.organizationId, session.organizationId)]
    if (status) conditions.push(eq(incidents.status, status as never))
    if (severity) conditions.push(eq(incidents.severity, severity as never))
    if (storeId) conditions.push(eq(incidents.storeId, storeId))

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)` })
      .from(incidents)
      .where(and(...conditions))

    const items = await db
      .select({
        id: incidents.id,
        type: incidents.type,
        title: incidents.title,
        summary: incidents.summary,
        severity: incidents.severity,
        riskLevel: incidents.riskLevel,
        status: incidents.status,
        whyFlagged: incidents.whyFlagged,
        followUpCount: incidents.followUpCount,
        createdAt: incidents.createdAt,
        employeeId: incidents.employeeId,
        storeId: incidents.storeId,
        employeeName: employees.name,
        storeName: stores.name,
      })
      .from(incidents)
      .leftJoin(employees, eq(employees.id, incidents.employeeId))
      .leftJoin(stores, eq(stores.id, incidents.storeId))
      .where(and(...conditions))
      .orderBy(desc(incidents.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    return NextResponse.json({ items, total: Number(total), page, pageSize, hasNext: (page - 1) * pageSize + items.length < Number(total) })
  } catch (err) {
    console.error('[incidents]', err)
    return NextResponse.json({ error: 'Failed to load incidents' }, { status: 500 })
  }
}
