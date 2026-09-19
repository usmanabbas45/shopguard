import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { canAccess } from '@/lib/auth'

const userSchema = z.object({
  action: z.enum(['recalculate_baselines', 'analyze_all', 'process_followups', 'analyze_batch']),
  importJobId: z.string().optional(),
  organizationId: z.string().optional(), // for worker use
  txIds: z.array(z.string()).optional(), // for analyze_batch
})

// Worker auth check (separate from user session)
function isWorkerRequest(req: NextRequest): { valid: boolean; orgId?: string } {
  const workerKey = req.headers.get('x-worker-key')
  const configuredKey = process.env.WORKER_SECRET
  if (!configuredKey || configuredKey.length < 16) return { valid: false }
  if (workerKey !== configuredKey) return { valid: false }
  return { valid: true }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Allow either user session OR worker key
    const workerAuth = isWorkerRequest(req)
    let orgId: string

    // Validate body shape first (both paths need this)
    const parsed = userSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
    const { action, importJobId, txIds } = parsed.data

    if (workerAuth.valid) {
      // Worker authenticated — organisationId must be in body
      const orgIdFromBody = (body as Record<string, unknown>).organizationId
      if (!orgIdFromBody || typeof orgIdFromBody !== 'string') {
        return NextResponse.json({ error: 'organizationId required for worker requests' }, { status: 400 })
      }
      orgId = orgIdFromBody
    } else {
      // Require user session
      const session = await getSession()
      if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      if (!canAccess(session.role, 'MANAGER')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      if (session.isDemo) return NextResponse.json({ error: 'Not available in demo mode' }, { status: 400 })
      orgId = session.organizationId
    }

    if (action === 'recalculate_baselines') {
      const { recalculateAllBaselines } = await import('@/lib/services/baseline-engine')
      const result = await recalculateAllBaselines(orgId)
      return NextResponse.json({ success: true, result })
    }

    if (action === 'analyze_all') {
      if (!importJobId) return NextResponse.json({ error: 'importJobId required' }, { status: 400 })
      const { analyzeImportedTransactions } = await import('@/lib/services/analysis-pipeline')
      const result = await analyzeImportedTransactions(orgId, importJobId)
      return NextResponse.json({ success: true, result })
    }

    if (action === 'analyze_batch') {
      if (!txIds?.length) return NextResponse.json({ analyzed: 0, incidentsCreated: 0 })
      const { analyzeTransactionBatch } = await import('@/lib/services/analysis-pipeline')
      const result = await analyzeTransactionBatch(orgId, txIds)
      return NextResponse.json({ success: true, analyzed: result.analyzed, incidentsCreated: result.incidentsCreated })
    }

    if (action === 'process_followups') {
      const { processFollowUps } = await import('@/lib/services/notification-engine')
      const sent = await processFollowUps()
      return NextResponse.json({ success: true, followUpsSent: sent })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('[analysis]', err)
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 })
  }
}
