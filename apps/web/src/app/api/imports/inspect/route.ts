import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { inspectCSV } from '@/lib/csv-import'


export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 400 })

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'csv' && ext !== 'txt') return NextResponse.json({ error: 'Only CSV files are supported' }, { status: 400 })

    const content = await file.text()
    if (!content.trim()) return NextResponse.json({ error: 'File is empty' }, { status: 400 })

    const result = await inspectCSV(content)
    return NextResponse.json({ success: true, result, filename: file.name, fileSize: file.size })
  } catch (err) {
    console.error('[import/inspect]', err)
    return NextResponse.json({ error: 'Failed to inspect CSV file' }, { status: 500 })
  }
}
