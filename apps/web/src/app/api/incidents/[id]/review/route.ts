import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { getSession } from '@/lib/auth'

const reviewSchema = z.object({
  label: z.enum(['VALID_INCIDENT', 'FALSE_POSITIVE', 'NEEDS_INVESTIGATION', 'NOT_ENOUGH_EVIDENCE']),
  notes: z.string().max(2000).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params

    const body = await req.json()
    const parsed = reviewSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
    const { label, notes } = parsed.data

    if (session.isDemo) {
      return NextResponse.json({ success: true, message: 'Review saved (demo mode)' })
    }

    const db = (await import('@/lib/db')).getDb()
    const { incidents, incidentReviews, auditLogs } = await import('@shopguard/database')
    const { eq, and } = await import('drizzle-orm')

    const [incident] = await db
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.id, id), eq(incidents.organizationId, session.organizationId)))
      .limit(1)

    if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    await db.insert(incidentReviews).values({
      id: nanoid(),
      incidentId: id,
      userId: session.id,
      label,
      notes: notes ?? null,
    })

    // Update incident status
    const newStatus = label === 'VALID_INCIDENT' || label === 'FALSE_POSITIVE' ? 'RESOLVED' : 'UNDER_REVIEW'
    await db.update(incidents).set({ status: newStatus as never, updatedAt: new Date() }).where(eq(incidents.id, id))

    // Audit log
    await db.insert(auditLogs).values({
      id: nanoid(),
      organizationId: session.organizationId,
      userId: session.id,
      action: 'incident_reviewed',
      entity: 'incident',
      entityId: id,
      metadata: { label, notes },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[incident/review]', err)
    return NextResponse.json({ error: 'Failed to save review' }, { status: 500 })
  }
}
