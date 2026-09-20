/**
 * GET  /api/settings/api-keys  — List org's API keys (no secrets)
 * POST /api/settings/api-keys  — Create new API key (returns secret ONCE)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createApiKey, listApiKeys } from '@/lib/ingestion/api-keys'
import { z } from 'zod'

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  storeId: z.string().optional().nullable(),
})

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const keys = await listApiKeys(session.organizationId)
  return NextResponse.json({ keys })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['OWNER', 'ADMIN'].includes(session.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (session.isDemo) {
    return NextResponse.json({ error: 'Demo organizations cannot create API keys' }, { status: 400 })
  }

  const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 422 })

  const result = await createApiKey({
    organizationId: session.organizationId,
    name: parsed.data.name,
    storeId: parsed.data.storeId,
  })

  return NextResponse.json({
    id: result.id,
    name: result.name,
    secret: result.secret,   // ONLY returned here — not stored
    prefix: result.prefix,
    createdAt: result.createdAt,
    warning: 'Save this secret key now. It will not be shown again.',
  }, { status: 201 })
}
