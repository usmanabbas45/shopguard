'use client'

import { useState, useEffect } from 'react'
import { DollarSign, AlertTriangle, CheckCircle, TrendingDown, Calendar, RefreshCw } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'

interface CashSession {
  id: string; date: string; store?: string; register?: string; employee?: string
  storeName?: string; registerName?: string; employeeName?: string
  openingCash: string | number; expectedCash: string | number
  countedCash: string | number | null; variance: string | number | null
  isReconciled: boolean
}

// Currency comes from org settings via API — do not hardcode
const CURRENCY = 'USD' // fallback only

function VarianceBadge({ variance }: { variance: number }) {
  const isNeg = variance < 0
  const isZero = Math.abs(variance) < 10
  return (
    <span className={cn('font-mono font-semibold text-sm', isZero ? 'text-green-600' : isNeg ? 'text-red-600' : 'text-amber-600')}>
      {isNeg ? '▼' : variance > 10 ? '▲' : '='} {formatCurrency(Math.abs(variance), CURRENCY)}
    </span>
  )
}

export default function CashPage() {
  const [sessions, setSessions] = useState<CashSession[]>([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState('today')

  useEffect(() => {
    fetch('/api/cash')
      .then(r => r.json())
      .then(d => { setSessions(d.sessions ?? []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const parsedSessions = sessions.map(s => ({
    ...s,
    storeName: s.storeName ?? s.store ?? 'Unknown',
    registerName: s.registerName ?? s.register ?? 'Unknown',
    employeeName: s.employeeName ?? s.employee ?? 'Unknown',
    expected: Number(s.expectedCash ?? 0),
    counted: Number(s.countedCash ?? 0),
    variance: s.variance !== null && s.variance !== undefined ? Number(s.variance) : null,
    dateStr: typeof s.date === 'string' ? s.date : new Date(s.date).toLocaleDateString(),
  }))

  // Simple today filter based on date string
  const today = new Date().toISOString().split('T')[0]
  const filtered = dateFilter === 'today'
    ? parsedSessions.filter(s => s.date === today || s.date === 'Today')
    : parsedSessions.slice(0, 30)

  const totalVariance = filtered.reduce((sum, s) => sum + (s.variance ?? 0), 0)
  const flaggedCount = filtered.filter(s => s.variance !== null && Math.abs(s.variance) > 500).length

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Cash Reconciliation</h1>
          <p className="text-sm text-slate-500 mt-0.5">Expected vs counted cash per register and shift</p>
        </div>
        <select value={dateFilter} onChange={e => setDateFilter(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
          <option value="today">Today</option>
          <option value="all">Recent (30)</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32"><RefreshCw className="w-6 h-6 text-slate-300 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <DollarSign className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-600">No cash sessions found</p>
          <p className="text-xs text-slate-400 mt-1">Cash reconciliation data will appear after import.</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-1"><DollarSign className="w-4 h-4 text-slate-400" /><span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Cash Expected</span></div>
              <p className="text-xl font-bold text-slate-900">{formatCurrency(filtered.reduce((s, c) => s + c.expected, 0), CURRENCY)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-1"><CheckCircle className="w-4 h-4 text-slate-400" /><span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Total Counted</span></div>
              <p className="text-xl font-bold text-slate-900">{formatCurrency(filtered.reduce((s, c) => s + c.counted, 0), CURRENCY)}</p>
            </div>
            <div className={cn('rounded-xl border p-4', Math.abs(totalVariance) > 500 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200')}>
              <div className="flex items-center gap-2 mb-1"><TrendingDown className={cn('w-4 h-4', Math.abs(totalVariance) > 500 ? 'text-red-400' : 'text-green-400')} /><span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Net Variance</span></div>
              <p className={cn('text-xl font-bold', Math.abs(totalVariance) > 500 ? 'text-red-700' : 'text-green-700')}>
                {totalVariance >= 0 ? '+' : ''}{formatCurrency(totalVariance, CURRENCY)}
              </p>
              {flaggedCount > 0 && <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{flaggedCount} register{flaggedCount > 1 ? 's' : ''} flagged</p>}
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50">
                <tr>{['Date','Store / Register','Employee','Expected','Counted','Variance','Status'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(session => {
                  const flagged = session.variance !== null && Math.abs(session.variance) > 500
                  return (
                    <tr key={session.id} className={cn('hover:bg-slate-50 transition-colors', flagged && 'bg-red-50/50')}>
                      <td className="px-4 py-3.5"><div className="flex items-center gap-1.5 text-slate-700"><Calendar className="w-3.5 h-3.5 text-slate-400" />{session.dateStr}</div></td>
                      <td className="px-4 py-3.5"><p className="font-medium text-slate-900">{session.storeName}</p><p className="text-xs text-slate-400">{session.registerName}</p></td>
                      <td className="px-4 py-3.5 text-slate-700">{session.employeeName}</td>
                      <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-700">{formatCurrency(session.expected, CURRENCY)}</td>
                      <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-700">{session.countedCash !== null ? formatCurrency(session.counted, CURRENCY) : '—'}</td>
                      <td className="px-4 py-3.5 text-right">{session.variance !== null ? <VarianceBadge variance={session.variance} /> : <span className="text-xs text-slate-400">Not counted</span>}</td>
                      <td className="px-4 py-3.5 text-center">
                        {flagged
                          ? <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full"><AlertTriangle className="w-3 h-3" />Review</span>
                          : <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full"><CheckCircle className="w-3 h-3" />OK</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600">
            <strong>Cash variance is not automatically an incident.</strong> ShopGuard flags large or repeated variances for your review — you decide what requires investigation.
          </div>
        </>
      )}
    </div>
  )
}
