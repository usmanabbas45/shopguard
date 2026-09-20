'use client'

import { useState, useEffect } from 'react'
import { MapPin, Store, AlertTriangle, TrendingUp, Users, RefreshCw } from 'lucide-react'
import { formatCurrency, cn } from '@/lib/utils'

interface StoreData {
  id: string; name: string; code?: string; address?: string
  registers: number; employees: number; txCount: number; avgTx: number | null
  voidRate: number; incidents: number; todaySales: number; cashVariance: number | null
  riskLevel: string
}

// Currency comes from org settings via API — do not hardcode
const CURRENCY = 'USD' // fallback only

function RiskBadge({ level }: { level: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border',
      level === 'HIGH' ? 'text-red-700 bg-red-50 border-red-200' :
      level === 'MEDIUM' ? 'text-amber-700 bg-amber-50 border-amber-200' :
      'text-green-700 bg-green-50 border-green-200'
    )}>
      {level} RISK
    </span>
  )
}

export default function StoresPage() {
  const [stores, setStores] = useState<StoreData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/stores')
      .then(r => r.json())
      .then(d => setStores(d.stores ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="max-w-4xl space-y-5">
        <div><h1 className="text-xl font-bold text-slate-900">Stores</h1></div>
        <div className="flex items-center justify-center h-32"><RefreshCw className="w-6 h-6 text-slate-300 animate-spin" /></div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Stores</h1>
          <p className="text-sm text-slate-500 mt-0.5">{stores.length} location{stores.length !== 1 ? 's' : ''} · store-level analytics</p>
        </div>
        <button className="text-sm font-medium bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors">
          + Add Store
        </button>
      </div>

      {stores.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <Store className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-600">No stores found</p>
          <p className="text-xs text-slate-400 mt-1">Import transaction data to see store analytics.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {stores.map(store => (
            <div key={store.id} className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-brand-50 rounded-lg">
                    <Store className="w-5 h-5 text-brand-600" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-slate-900">{store.name}</h2>
                    {store.address && (
                      <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
                        <MapPin className="w-3 h-3" />{store.address}
                      </div>
                    )}
                  </div>
                </div>
                <RiskBadge level={store.riskLevel} />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Today&apos;s Sales</p>
                  <p className="font-semibold text-slate-900">{formatCurrency(store.todaySales, CURRENCY)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Cash Variance</p>
                  <p className={cn('font-semibold', store.cashVariance === null ? 'text-slate-400' : store.cashVariance < -100 ? 'text-red-600' : store.cashVariance > 100 ? 'text-amber-600' : 'text-green-600')}>
                    {store.cashVariance === null ? '—' : `${store.cashVariance > 0 ? '+' : ''}${formatCurrency(store.cashVariance, CURRENCY)}`}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Void Rate</p>
                  <p className={cn('font-semibold', store.voidRate > 0.03 ? 'text-amber-600' : 'text-slate-700')}>
                    {(store.voidRate * 100).toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Open Incidents</p>
                  <p className={cn('font-semibold flex items-center gap-1', store.incidents > 0 ? 'text-red-600' : 'text-green-600')}>
                    {store.incidents > 0 && <AlertTriangle className="w-3.5 h-3.5" />}
                    {store.incidents}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4 mt-4 pt-4 border-t border-slate-100 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{store.employees} employee{store.employees !== 1 ? 's' : ''}</span>
                <span>{store.registers} register{store.registers !== 1 ? 's' : ''}</span>
                {store.txCount > 0 && <span>{store.txCount.toLocaleString()} total transactions</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
