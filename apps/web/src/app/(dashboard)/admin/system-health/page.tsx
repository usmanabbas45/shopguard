'use client'

import { useState, useEffect } from 'react'
import { Activity, Database, Cpu, Bell, Clock, Server, RefreshCw, CheckCircle, AlertTriangle, XCircle, Brain } from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'
import type { SystemHealth } from '@/lib/services/health-check'

const COMPONENT_ICONS: Record<string, React.ElementType> = {
  database: Database,
  redis: Server,
  ml: Brain,
  workers: Cpu,
  notifications: Bell,
  storage: Activity,
  scheduler: Clock,
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    healthy: { icon: CheckCircle, cls: 'text-green-700 bg-green-50 border-green-200', label: 'Healthy' },
    warning: { icon: AlertTriangle, cls: 'text-amber-700 bg-amber-50 border-amber-200', label: 'Warning' },
    critical: { icon: XCircle, cls: 'text-red-700 bg-red-50 border-red-200', label: 'Critical' },
    unknown: { icon: Activity, cls: 'text-slate-600 bg-slate-50 border-slate-200', label: 'Unknown' },
  }[status] ?? { icon: Activity, cls: 'text-slate-600 bg-slate-50 border-slate-200', label: status }

  const Icon = config.icon
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border', config.cls)}>
      <Icon className="w-3.5 h-3.5" />
      {config.label}
    </span>
  )
}

function StatusDot({ status }: { status: string }) {
  return (
    <div className={cn('w-2 h-2 rounded-full flex-shrink-0', {
      'bg-green-500': status === 'healthy',
      'bg-amber-500 animate-pulse': status === 'warning',
      'bg-red-500 animate-pulse': status === 'critical',
      'bg-slate-400': status === 'unknown',
    })} />
  )
}

export default function SystemHealthPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [queueStats, setQueueStats] = useState<Record<string, { waiting: number; active: number; failed: number }>>({})

  async function load() {
    setLoading(true)
    try {
      const [healthRes, queueRes] = await Promise.all([
        fetch('/api/admin/health'),
        fetch('/api/admin/queue-stats'),
      ])
      if (healthRes.ok) setHealth(await healthRes.json())
      if (queueRes.ok) {
        const d = await queueRes.json()
        setQueueStats(d.stats ?? {})
      }
    } catch {}
    setLoading(false)
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 30000) // Refresh every 30s
    return () => clearInterval(interval)
  }, [])

  const overallColor = {
    healthy: 'text-green-700',
    warning: 'text-amber-700',
    critical: 'text-red-700',
  }[health?.overall ?? 'healthy'] ?? 'text-slate-700'

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-brand-600" />
            System Health
          </h1>
          {health && (
            <p className={cn('text-sm font-medium mt-0.5', overallColor)}>
              Overall: {health.overall.toUpperCase()}
              {health.timestamp && <span className="text-slate-400 font-normal ml-2">· Last checked {timeAgo(health.timestamp)}</span>}
            </p>
          )}
        </div>
        <button onClick={load} disabled={loading} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Component health grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {loading && !health ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
              <div className="h-4 bg-slate-200 rounded w-1/3 mb-3" />
              <div className="h-3 bg-slate-100 rounded w-2/3" />
            </div>
          ))
        ) : health ? (
          Object.entries(health.components).map(([name, comp]) => {
            const Icon = COMPONENT_ICONS[name] ?? Server
            return (
              <div
                key={name}
                className={cn('bg-white rounded-xl border p-5', {
                  'border-slate-200': comp.status === 'healthy',
                  'border-amber-200 bg-amber-50/30': comp.status === 'warning',
                  'border-red-200 bg-red-50/30': comp.status === 'critical',
                })}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Icon className={cn('w-4 h-4', {
                      'text-green-600': comp.status === 'healthy',
                      'text-amber-600': comp.status === 'warning',
                      'text-red-600': comp.status === 'critical',
                    })} />
                    <h3 className="font-medium text-slate-900 capitalize">{name}</h3>
                  </div>
                  <StatusBadge status={comp.status} />
                </div>
                {comp.detail && <p className="text-xs text-slate-600 mt-1">{comp.detail}</p>}
                {comp.latencyMs !== undefined && (
                  <p className="text-xs text-slate-400 mt-1">Latency: {comp.latencyMs}ms</p>
                )}
              </div>
            )
          })
        ) : null}
      </div>

      {/* Queue stats */}
      {Object.keys(queueStats).length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Job Queue Status</h2>
            <p className="text-xs text-slate-500 mt-0.5">Real-time BullMQ queue metrics</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Queue</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Waiting</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Active</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Completed</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Failed</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {Object.entries(queueStats).map(([name, stats]) => (
                  <tr key={name} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-900 capitalize">{name.toLowerCase()}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-600">{stats.waiting}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-brand-600 font-medium">{stats.active}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-green-600">{(stats as { completed?: number }).completed ?? 0}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      <span className={cn(stats.failed > 10 ? 'text-red-600 font-medium' : 'text-slate-600')}>
                        {stats.failed}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <StatusDot status={stats.failed > 50 ? 'critical' : stats.failed > 10 ? 'warning' : 'healthy'} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* No Redis warning */}
      {health?.components.redis?.status !== 'healthy' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800">
          <p className="font-medium mb-1">Redis not connected</p>
          <p>Background jobs are running inline (synchronous). For production, start Redis and set REDIS_URL. This is acceptable for development.</p>
        </div>
      )}
    </div>
  )
}
