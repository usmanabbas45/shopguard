'use client'

import { useState, useEffect } from 'react'
import { FileText, Download, Calendar, TrendingUp, AlertTriangle, DollarSign, RefreshCw } from 'lucide-react'
import { formatCurrency, formatDate, cn } from '@/lib/utils'

interface ReportSummary {
  date: string; title: string; summary: {
    sales: number; txCount: number; voidCount: number; refundCount: number
    incidents: { total: number; high: number; open: number }; currency: string
  }; isGenerated: boolean
}

interface PreviousReport { id: string; date: string; title: string; type: string }

export default function ReportsPage() {
  const [latestReport, setLatestReport] = useState<ReportSummary | null>(null)
  const [previousReports, setPreviousReports] = useState<PreviousReport[]>([])
  const [loading, setLoading] = useState(true)
  const [isDemo, setIsDemo] = useState(false)

  useEffect(() => {
    fetch('/api/reports')
      .then(r => r.json())
      .then(d => {
        setLatestReport(d.latestReport)
        setPreviousReports(d.previousReports ?? [])
        setIsDemo(d.isDemo ?? false)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 text-slate-300 animate-spin" />
      </div>
    )
  }

  const s = latestReport?.summary
  const currency = s?.currency ?? 'USD'

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Reports</h1>
          <p className="text-sm text-slate-500 mt-0.5">Daily summaries and historical reports</p>
        </div>
      </div>

      {/* Today's report */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-brand-600" />
            <h2 className="text-sm font-semibold text-slate-900">
              {latestReport ? latestReport.title : "Today's Daily Report"}
            </h2>
            {latestReport?.isGenerated && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">Generated</span>
            )}
          </div>
          <button disabled className="flex items-center gap-1.5 text-xs text-slate-400 border border-slate-200 px-3 py-1.5 rounded-lg cursor-not-allowed">
            <Download className="w-3.5 h-3.5" /> Export PDF
          </button>
        </div>

        <div className="p-6">
          {!latestReport ? (
            <div className="text-center py-8">
              <FileText className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-600">No report generated yet</p>
              <p className="text-xs text-slate-400 mt-1">Daily reports are generated automatically at 06:00 UTC each day.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Sales & Activity */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Sales &amp; Activity</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Total Sales', value: formatCurrency(s?.sales ?? 0, currency), icon: TrendingUp, color: 'text-brand-600' },
                    { label: 'Transactions', value: (s?.txCount ?? 0).toLocaleString(), icon: FileText, color: 'text-slate-600' },
                    { label: 'Voids', value: (s?.voidCount ?? 0).toLocaleString(), icon: FileText, color: 'text-slate-600' },
                    { label: 'Refunds', value: (s?.refundCount ?? 0).toLocaleString(), icon: DollarSign, color: 'text-slate-600' },
                  ].map(({ label, value, icon: Icon, color }) => (
                    <div key={label} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                      <Icon className={cn('w-4 h-4 mb-1.5', color)} />
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className={cn('text-base font-bold mt-0.5', color)}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Incidents */}
              <div>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Incidents</h3>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Total', value: s?.incidents.total ?? 0, cls: 'bg-slate-50 border-slate-100' },
                    { label: 'High Priority', value: s?.incidents.high ?? 0, cls: 'bg-red-50 border-red-100' },
                    { label: 'Open / Unreviewed', value: s?.incidents.open ?? 0, cls: 'bg-amber-50 border-amber-100' },
                  ].map(({ label, value, cls }) => (
                    <div key={label} className={cn('rounded-lg p-3 border', cls)}>
                      <AlertTriangle className="w-4 h-4 text-slate-400 mb-1.5" />
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="text-base font-bold text-slate-900 mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-xs text-slate-400">Generated {latestReport.date ? formatDate(latestReport.date) : 'today'}</p>
            </div>
          )}
        </div>
      </div>

      {/* Previous reports */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Previous reports</h2>
        </div>
        {previousReports.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400">No previous reports</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {previousReports.map(report => (
              <div key={report.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-900">{report.title}</p>
                    <p className="text-xs text-slate-400">{formatDate(report.date)}</p>
                  </div>
                </div>
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">{report.type}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

