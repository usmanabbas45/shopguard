'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Users, AlertTriangle, TrendingUp, ArrowRight, Search, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Employee {
  id: string; name: string; role?: string; storeName?: string
  txCount: number; avgAmount: number | null; voidRate: number | null
  refundRate: number | null; discountRate: number | null
  incidents: number; baselineConf: string; riskLevel: string
}

function Badge({ level, type }: { level: string; type: 'risk' | 'conf' }) {
  if (type === 'conf') {
    const cls = level === 'HIGH' ? 'bg-green-100 text-green-700' : level === 'MEDIUM' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
    return <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', cls)}>{level} baseline</span>
  }
  const cls = level === 'HIGH' ? 'text-red-700 bg-red-50 border-red-200' : level === 'MEDIUM' ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-green-700 bg-green-50 border-green-200'
  return <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border', cls)}>{level}</span>
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'voidRate' | 'incidents'>('incidents')

  useEffect(() => {
    fetch('/api/employees').then(r => r.json()).then(d => { setEmployees(d.employees ?? []); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const filtered = employees
    .filter(e => !search || e.name.toLowerCase().includes(search.toLowerCase()) || (e.storeName ?? '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sortBy === 'voidRate' ? (b.voidRate ?? 0) - (a.voidRate ?? 0) : sortBy === 'incidents' ? b.incidents - a.incidents : a.name.localeCompare(b.name))

  return (
    <div className="max-w-5xl space-y-5">
      <div><h1 className="text-xl font-bold text-slate-900">Employee Analytics</h1><p className="text-sm text-slate-500 mt-0.5">Behavioral baselines and activity per employee</p></div>
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total', value: employees.length, icon: Users, color: 'text-slate-900' },
          { label: 'High Risk', value: employees.filter(e => e.riskLevel === 'HIGH').length, icon: AlertTriangle, color: 'text-red-700' },
          { label: 'Open Incidents', value: employees.reduce((s, e) => s + e.incidents, 0), icon: TrendingUp, color: 'text-slate-900' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-1"><Icon className="w-4 h-4 text-slate-400" /><span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span></div>
            <p className={cn('text-2xl font-bold', color)}>{value}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-72"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /><input type="text" placeholder="Search employees…" value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" /></div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
          <option value="incidents">Sort by incidents</option><option value="voidRate">Sort by void rate</option><option value="name">Sort by name</option>
        </select>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center"><RefreshCw className="w-6 h-6 text-slate-300 mx-auto mb-3 animate-spin" /><p className="text-sm text-slate-400">Loading…</p></div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center"><Users className="w-10 h-10 text-slate-200 mx-auto mb-3" /><p className="text-sm font-medium text-slate-600">No employees found</p><p className="text-xs text-slate-400 mt-1">Import transaction data to see employee analytics.</p></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50"><tr>
              {['Employee','Store','Transactions','Void Rate','Discount Rate','Baseline','Risk','Incidents',''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(emp => (
                <tr key={emp.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-5 py-3.5"><p className="font-medium text-slate-900">{emp.name}</p>{emp.role && <p className="text-xs text-slate-400">{emp.role}</p>}</td>
                  <td className="px-4 py-3.5 text-slate-600 text-xs">{emp.storeName ?? '—'}</td>
                  <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-700">{emp.txCount.toLocaleString()}</td>
                  <td className="px-4 py-3.5 text-right"><span className={cn('font-mono text-xs font-semibold', emp.voidRate === null ? 'text-slate-400' : emp.voidRate > 0.05 ? 'text-red-600' : emp.voidRate > 0.03 ? 'text-amber-600' : 'text-slate-700')}>{emp.voidRate !== null ? `${(emp.voidRate * 100).toFixed(1)}%` : '—'}</span></td>
                  <td className="px-4 py-3.5 text-right"><span className={cn('font-mono text-xs font-semibold', emp.discountRate === null ? 'text-slate-400' : emp.discountRate > 0.15 ? 'text-amber-600' : 'text-slate-700')}>{emp.discountRate !== null ? `${(emp.discountRate * 100).toFixed(1)}%` : '—'}</span></td>
                  <td className="px-4 py-3.5 text-center"><Badge level={emp.baselineConf} type="conf" /></td>
                  <td className="px-4 py-3.5 text-center"><Badge level={emp.riskLevel} type="risk" /></td>
                  <td className="px-4 py-3.5 text-center">{emp.incidents > 0 ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-200"><AlertTriangle className="w-3 h-3" />{emp.incidents}</span> : <span className="text-xs text-slate-400">—</span>}</td>
                  <td className="px-4 py-3.5"><Link href={`/employees/${emp.id}`} className="text-brand-600 opacity-0 group-hover:opacity-100 transition-opacity"><ArrowRight className="w-4 h-4" /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800"><strong>Note:</strong> Metrics use per-employee baselines, not raw counts. Context matters — a high void rate may be normal for high-volume employees.</div>
    </div>
  )
}
