import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { canAccess } from '@/lib/auth'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccess(session.role, 'ADMIN')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const mlUrl = process.env.ML_SERVICE_URL
    if (!mlUrl) {
      return NextResponse.json({ status: 'unavailable', modelStatus: 'no_service', modelId: null, modelType: null, featureVersion: '1.0.0' })
    }

    try {
      const res = await fetch(`${mlUrl}/health`, { signal: AbortSignal.timeout(3000) })
      const data = await res.json()
      return NextResponse.json(data)
    } catch {
      return NextResponse.json({ status: 'unreachable', modelStatus: 'unknown', modelId: null, modelType: null, featureVersion: '1.0.0' })
    }
  } catch (err) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
