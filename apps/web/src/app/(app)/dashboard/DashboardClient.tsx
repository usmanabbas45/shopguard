'use client'

import Link from 'next/link'
import { AlertTriangle, TrendingUp, Eye, DollarSign, ArrowRight, Clock, CheckCircle, AlertCircle } from 'lucide-react'
import { formatCurrency, formatDateTime, getRiskColor, getStatusColor, timeAgo, cn } from '@/lib/utils'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts'

interface Stats {
  todaySales: number
  cashExpected?: number
  cashCounted?: number
  cashVariance?: number
  highPriorityCount: number
  mediumPriorityCount: number
  reviewedToday?: number
  unreviewedCount: number
  transactionCount: number
  voidCount?: number
  refundCount?: number
  currency: string
}

interface Incident {
  id: string
  title: string
  summary: string
  riskLevel: string
  severity: string
  status: string
  whyFlagged: string[]
  employeeName?: string
  storeName?: string
  createdAt: Date | string
  type: string
}

interface Props {
  initialStats: Stats | null
  initialIncidents: Incident[]
  isDemo: boolean
}

// Synthetic trend data for demo
const trendData = [
  { day: 'Mon', incidents: 2, sales: 412000 },
  { day: 'Tue', incidents: 1, sales: 389000 },
  { day: 'Wed', incidents: 4, sales: 451000 },
  { day: 'Thu', incidents: 3, sales: 398000 },
  { day: 'Fri', incidents: 6, sales: 523000 },
  { day: 'Sat', incidents: 5, sales: 611000 },
  { day: 'Today', incidents: 7, sales: 487000 },
]

const incidentTypeData = [
  { type: 'Void/Cash', count: 8 },
  { type: 'Discount', count: 5 },
  { type: 'After-Hours', count: 3 },
  { type: 'Large Refund', count: 4 },
  { type: 'Cash Var.', count: 2 },
]

function StatCard({
  label, value, sub, icon: Icon, color = 'text-slate-900', accent
}: {
  label: string; value: string; sub?: string; icon: React.ElementType; color?: string; accent?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
        <div className={cn('p-2 rounded-lg', accent ?? 'bg-slate-100')}>
          <Icon className={cn('w-4 h-4', color)} />
        </div>
      </div>
      <p className={cn('text-2xl font-bold', color)}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  )
}

function RiskBadge({ level }: { level: string }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border', getRiskColor(level))}>
      {level}
    </span>
  )
}

function IncidentRow({ incident }: { incident: Incident }) {
  return (
    <Link
      href={`/incidents/${incident.id}`}
      className="flex items-start gap-4 p-4 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0 group"
    >
      <div className="mt-0.5">
        <RiskBadge level={incident.riskLevel} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 group-hover:text-brand-600 transition-colors">{incident.title}</p>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{incident.whyFlagged?.[0] ?? incident.summary}</p>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
          {incident.employeeName && <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{incident.employeeName}</span>}
          {incident.storeName && <span>{incident.storeName}</span>}
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{timeAgo(incident.createdAt)}</span>
        </div>
      </div>
      <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-brand-500 transition-colors mt-0.5 flex-shrink-0" />
    </Link>
  )
}

export default function DashboardClient({ initialStats: stats, initialIncidents: incidents, isDemo }: Props) {
  if (!stats) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-slate-900 mb-2">No data yet</h2>
        <p className="text-slate-500 mb-6 text-sm">Import your POS transaction data to start building your baseline and detecting unusual activity.</p>
        <Link href="/import" className="inline-flex items-center gap-2 bg-brand-600 text-white font-medium px-5 py-2.5 rounded-lg hover:bg-brand-700 text-sm">
          Import Transaction Data
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    )
  }

  const hasVariance = stats.cashVariance !== undefined
  const varianceIsNeg = (stats.cashVariance ?? 0) < 0

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">{new Date().toLocaleDateString('en-PK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <Link href="/import" className="inline-flex items-center gap-2 text-sm font-medium bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors">
          + Import Data
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Today's Sales"
          value={formatCurrency(stats.todaySales, stats.currency)}
          sub={`${stats.transactionCount} transactions`}
          icon={TrendingUp}
          accent="bg-brand-50"
          color="text-brand-700"
        />
        {hasVariance ? (
          <StatCard
            label="Cash Variance"
            value={formatCurrency(Math.abs(stats.cashVariance!), stats.currency)}
            sub={varianceIsNeg ? 'Short vs expected' : 'Over expected'}
            icon={DollarSign}
            color={varianceIsNeg ? 'text-red-600' : 'text-green-600'}
            accent={varianceIsNeg ? 'bg-red-50' : 'bg-green-50'}
          />
        ) : (
          <StatCard
            label="Cash Expected"
            value={stats.cashExpected ? formatCurrency(stats.cashExpected, stats.currency) : '—'}
            sub="Not yet reconciled"
            icon={DollarSign}
            color="text-slate-600"
          />
        )}
        <StatCard
          label="Needs Review"
          value={String(stats.unreviewedCount)}
          sub={`${stats.highPriorityCount} high priority`}
          icon={AlertTriangle}
          color={stats.highPriorityCount > 0 ? 'text-red-600' : 'text-amber-600'}
          accent={stats.highPriorityCount > 0 ? 'bg-red-50' : 'bg-amber-50'}
        />
        <StatCard
          label="Reviewed Today"
          value={String(stats.reviewedToday ?? 0)}
          sub="Incidents closed"
          icon={CheckCircle}
          color="text-green-600"
          accent="bg-green-50"
        />
      </div>

      {/* Charts + Incidents */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Weekly trend */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">Incidents this week</h2>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Line type="monotone" dataKey="incidents" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Incidents by type */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">By incident type</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={incidentTypeData} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <YAxis dataKey="type" type="category" tick={{ fontSize: 10 }} width={70} stroke="#94a3b8" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
              <Bar dataKey="count" fill="#6366f1" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Incidents needing attention */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Needs attention</h2>
          <Link href="/incidents" className="text-xs font-medium text-brand-600 hover:text-brand-700 flex items-center gap-1">
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {incidents.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle className="w-10 h-10 text-green-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-600">All clear</p>
            <p className="text-xs text-slate-400 mt-1">No open incidents require your attention.</p>
          </div>
        ) : (
          <div>
            {incidents
              .filter(i => i.status === 'OPEN' || i.status === 'UNDER_REVIEW')
              .sort((a, b) => (b.riskLevel === 'HIGH' ? 1 : 0) - (a.riskLevel === 'HIGH' ? 1 : 0))
              .slice(0, 5)
              .map(incident => (
                <IncidentRow key={incident.id} incident={incident} />
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
