/**
 * DELETE /api/settings/api-keys/[id]  — Revoke API key immediately
 * POST   /api/settings/api-keys/[id]  — Rotate API key (revokes old, creates new)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { revokeApiKey, rotateApiKey } from '@/lib/ingestion/api-keys'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['OWNER', 'ADMIN'].includes(session.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { id } = await params
  const revoked = await revokeApiKey(id, session.organizationId)
  if (!revoked) return NextResponse.json({ error: 'Key not found' }, { status: 404 })

  return NextResponse.json({ revoked: true })
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['OWNER', 'ADMIN'].includes(session.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (session.isDemo) {
    return NextResponse.json({ error: 'Demo organizations cannot rotate API keys' }, { status: 400 })
  }

  const { id } = await params
  const result = await rotateApiKey(id, session.organizationId)
  if (!result) return NextResponse.json({ error: 'Key not found or already revoked' }, { status: 404 })

  return NextResponse.json({
    id: result.id,
    name: result.name,
    secret: result.secret,   // Shown ONCE only
    prefix: result.prefix,
    createdAt: result.createdAt,
    warning: 'Old key has been revoked. Save this new secret — it will not be shown again.',
  }, { status: 201 })
}

