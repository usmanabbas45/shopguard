import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateDemoIncidents } from '@/lib/demo-data'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params

    if (session.isDemo) {
      const all = generateDemoIncidents()
      const incident = all.find(i => i.id === id)
      if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })
      return NextResponse.json({ incident })
    }

    const db = (await import('@/lib/db')).getDb()
    const { incidents, employees, stores, registers, incidentEvidence, incidentReviews } = await import('@shopguard/database')
    const { eq, and } = await import('drizzle-orm')

    const [incident] = await db
      .select()
      .from(incidents)
      .where(and(eq(incidents.id, id), eq(incidents.organizationId, session.organizationId)))
      .limit(1)

    if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    const [employee] = incident.employeeId
      ? await db.select().from(employees).where(eq(employees.id, incident.employeeId)).limit(1)
      : [null]

    const [store] = incident.storeId
      ? await db.select().from(stores).where(eq(stores.id, incident.storeId)).limit(1)
      : [null]

    const evidence = await db.select().from(incidentEvidence).where(eq(incidentEvidence.incidentId, id))
    const reviews = await db.select().from(incidentReviews).where(eq(incidentReviews.incidentId, id))

    return NextResponse.json({ incident: { ...incident, employee, store, evidence, reviews } })
  } catch (err) {
    console.error('[incident/get]', err)
    return NextResponse.json({ error: 'Failed to load incident' }, { status: 500 })
  }
}
