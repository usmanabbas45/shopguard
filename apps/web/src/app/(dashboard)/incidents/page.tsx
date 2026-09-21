'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, Filter, Search, ArrowRight, Clock, User, Store, RefreshCw } from 'lucide-react'
import { getRiskColor, getStatusColor, timeAgo, cn } from '@/lib/utils'

interface Incident {
  id: string
  title: string
  summary: string
  riskLevel: string
  severity: string
  status: string
  type: string
  whyFlagged: string[]
  employeeName?: string
  storeName?: string
  createdAt: string
  followUpCount: number
}

const STATUS_OPTS = ['', 'OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED']
const SEVERITY_OPTS = ['', 'HIGH', 'MEDIUM', 'LOW']

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [severity, setSeverity] = useState('')
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: '25' })
    if (status) params.set('status', status)
    if (severity) params.set('severity', severity)
    try {
      const res = await fetch(`/api/incidents?${params}`)
      const data = await res.json()
      setIncidents(data.items ?? [])
      setTotal(data.total ?? 0)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [page, status, severity])

  const filtered = search
    ? incidents.filter(i =>
        i.title.toLowerCase().includes(search.toLowerCase()) ||
        i.employeeName?.toLowerCase().includes(search.toLowerCase()) ||
        i.storeName?.toLowerCase().includes(search.toLowerCase())
      )
    : incidents

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Incidents</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total} total · review flagged events</p>
        </div>
        <button onClick={load} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search incidents, employees, stores…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1) }}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All statuses</option>
          {STATUS_OPTS.slice(1).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select
          value={severity}
          onChange={e => { setSeverity(e.target.value); setPage(1) }}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All severities</option>
          {SEVERITY_OPTS.slice(1).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Incidents list */}
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {loading ? (
          <div className="py-16 text-center">
            <RefreshCw className="w-6 h-6 text-slate-300 mx-auto mb-3 animate-spin" />
            <p className="text-sm text-slate-400">Loading incidents…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <AlertTriangle className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-600">No incidents found</p>
            <p className="text-xs text-slate-400 mt-1">
              {total === 0 ? 'Import POS data to begin detecting unusual activity.' : 'Try adjusting your filters.'}
            </p>
          </div>
        ) : (
          filtered.map(incident => (
            <Link
              key={incident.id}
              href={`/incidents/${incident.id}`}
              className="flex items-start gap-4 p-4 hover:bg-slate-50 transition-colors group"
            >
              {/* Risk indicator */}
              <div className="flex-shrink-0 mt-0.5">
                <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border', getRiskColor(incident.riskLevel))}>
                  {incident.riskLevel}
                </span>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold text-slate-900 group-hover:text-brand-600 transition-colors">{incident.title}</p>
                  <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', getStatusColor(incident.status))}>
                    {incident.status.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-2 line-clamp-1">{incident.whyFlagged?.[0] ?? incident.summary}</p>
                <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                  {incident.employeeName && (
                    <span className="flex items-center gap-1"><User className="w-3 h-3" />{incident.employeeName}</span>
                  )}
                  {incident.storeName && (
                    <span className="flex items-center gap-1"><Store className="w-3 h-3" />{incident.storeName}</span>
                  )}
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{timeAgo(incident.createdAt)}</span>
                  {incident.followUpCount > 0 && (
                    <span className="text-amber-600">{incident.followUpCount} follow-up{incident.followUpCount > 1 ? 's' : ''} sent</span>
                  )}
                </div>
              </div>

              <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-brand-500 flex-shrink-0 mt-1 transition-colors" />
            </Link>
          ))
        )}
      </div>

      {/* Pagination */}
      {total > 25 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 text-xs"
            >Previous</button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page * 25 >= total}
              className="px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 text-xs"
            >Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
