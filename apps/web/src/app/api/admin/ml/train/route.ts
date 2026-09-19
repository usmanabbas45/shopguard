import { NextResponse } from 'next/server'
import { getSession, canAccess } from '@/lib/auth'

export async function POST() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccess(session.role, 'ADMIN')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (session.isDemo) return NextResponse.json({ error: 'Not available in demo mode' }, { status: 400 })

    const db = (await import('@/lib/db')).getDb()
    const { incidents, incidentReviews, featureSnapshots, incidentTransactions } = await import('@shopguard/database')
    const { eq, and, inArray, sql } = await import('drizzle-orm')

    const orgId = session.organizationId

    // Collect reviewed incidents scoped to this organization only
    // Explicitly exclude demo data from production ML training
    const reviews = await db
      .select({
        incidentId: incidentReviews.incidentId,
        label: incidentReviews.label,
      })
      .from(incidentReviews)
      .innerJoin(incidents, eq(incidents.id, incidentReviews.incidentId))
      .where(
        and(
          eq(incidents.organizationId, orgId),
          eq(incidents.isDemo, false) // NEVER train on demo data
        )
      )
      .limit(10000)

    if (reviews.length < 20) {
      return NextResponse.json({
        success: false,
        error: `Insufficient reviewed incidents: ${reviews.length}. Need at least 20.`,
      })
    }

    // Build label map: VALID_INCIDENT=1, FALSE_POSITIVE=0
    const labelMap: Record<string, number> = {
      VALID_INCIDENT: 1,
      FALSE_POSITIVE: 0,
      NEEDS_INVESTIGATION: 1,
      NOT_ENOUGH_EVIDENCE: 0,
    }

    // Gather features for reviewed incidents
    const incidentIds = reviews.map(r => r.incidentId)

    // Get transactions linked to each incident
    const linkedTxns = await db
      .select({ incidentId: incidentTransactions.incidentId, transactionId: incidentTransactions.transactionId })
      .from(incidentTransactions)
      .where(inArray(incidentTransactions.incidentId, incidentIds))

    // Get feature snapshots for those transactions
    const txIds = linkedTxns.map(l => l.transactionId)
    const snapshots = await db
      .select({ transactionId: featureSnapshots.transactionId, features: featureSnapshots.features })
      .from(featureSnapshots)
      .where(inArray(featureSnapshots.transactionId, txIds))

    const snapshotMap = new Map(snapshots.map(s => [s.transactionId, s.features]))
    const txToIncident = new Map(linkedTxns.map(l => [l.transactionId, l.incidentId]))

    // Build review label map
    const reviewLabelMap = new Map(reviews.map(r => [r.incidentId, labelMap[r.label] ?? 0]))

    // Pair features with labels
    const trainingFeatures: unknown[] = []
    const trainingLabels: number[] = []

    for (const [txId, features] of snapshotMap) {
      const incidentId = txToIncident.get(txId)
      if (!incidentId) continue
      const label = reviewLabelMap.get(incidentId)
      if (label === undefined) continue
      trainingFeatures.push(features)
      trainingLabels.push(label)
    }

    if (trainingFeatures.length < 20) {
      // Fall back to unsupervised if no feature snapshots yet
      // This means we haven't run analysis yet
      return NextResponse.json({
        success: false,
        error: `No feature snapshots found. Run transaction analysis first.`,
      })
    }

    // Call ML service to train
    const mlUrl = process.env.ML_SERVICE_URL
    if (!mlUrl) {
      return NextResponse.json({ success: false, error: 'ML service not configured (ML_SERVICE_URL not set)' })
    }

    const hasEnoughLabels =
      trainingLabels.filter(l => l === 1).length >= 20 &&
      trainingLabels.filter(l => l === 0).length >= 50

    const modelType = hasEnoughLabels ? 'hist_gradient_boosting' : 'isolation_forest'

    const res = await fetch(`${mlUrl}/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        features: trainingFeatures,
        labels: hasEnoughLabels ? trainingLabels : undefined,
        modelType,
        datasetId: `${orgId}-${Date.now()}`,
        organizationId: orgId,
      }),
      signal: AbortSignal.timeout(120000), // 2 minute timeout for training
    })

    const result = await res.json()
    return NextResponse.json(result)
  } catch (err) {
    console.error('[admin/ml/train]', err)
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
