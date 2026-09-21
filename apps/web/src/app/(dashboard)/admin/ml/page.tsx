'use client'

import { useState, useEffect } from 'react'
import { Brain, Activity, AlertCircle, CheckCircle, RefreshCw, Upload, Shield, ChevronDown, ChevronUp } from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'

interface ModelInfo {
  modelId: string
  modelType: string
  version: string
  status: string
  trainedAt: string | null
  sampleCount: number | null
  metrics: {
    rocAuc?: number
    precision?: number
    recall?: number
    f1?: number
    falsePositiveRate?: number
    meanScore?: number
    confusionMatrix?: number[][]
  } | null
}

interface MLStatus {
  status: string
  modelStatus: string
  modelId: string | null
  modelType: string | null
  featureVersion: string
}

interface DBStats {
  reviewedIncidents: number
  validIncidents: number
  falsePositives: number
  openIncidents: number
  totalTransactions: number
}

function MetricCard({ label, value, sub, color = 'text-slate-900' }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={cn('text-xl font-bold', color)}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function AdminMLPage() {
  const [mlStatus, setMlStatus] = useState<MLStatus | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [dbStats, setDbStats] = useState<DBStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [training, setTraining] = useState(false)
  const [trainResult, setTrainResult] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function loadStatus() {
    setLoading(true)
    try {
      // Fetch ML service status
      const mlUrl = process.env.NEXT_PUBLIC_ML_URL ?? '/api/admin/ml/status'
      const [statusRes, statsRes] = await Promise.all([
        fetch('/api/admin/ml/status'),
        fetch('/api/admin/ml/stats'),
      ])
      if (statusRes.ok) setMlStatus(await statusRes.json())
      if (statsRes.ok) {
        const d = await statsRes.json()
        setDbStats(d.stats)
        setModels(d.models ?? [])
      }
    } catch {}
    setLoading(false)
  }

  useEffect(() => { loadStatus() }, [])

  async function triggerTraining() {
    setTraining(true)
    setTrainResult(null)
    try {
      const res = await fetch('/api/admin/ml/train', { method: 'POST' })
      const data = await res.json()
      setTrainResult(data.success ? `Training started: ${data.modelId ?? 'queued'}` : `Error: ${data.error}`)
      await loadStatus()
    } catch (e) {
      setTrainResult('Training request failed')
    }
    setTraining(false)
  }

  const productionModel = models.find(m => m.status === 'PRODUCTION')
  const candidateModels = models.filter(m => m.status === 'CANDIDATE')

  const falsePositiveRate = dbStats && dbStats.reviewedIncidents > 0
    ? ((dbStats.falsePositives / dbStats.reviewedIncidents) * 100).toFixed(1)
    : null

  const canTrain = dbStats && dbStats.reviewedIncidents >= 20

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Brain className="w-5 h-5 text-brand-600" />
            ML & Model Administration
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Internal view — not visible to store managers</p>
        </div>
        <button onClick={loadStatus} disabled={loading} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* ML Service Status */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">ML Service</h2>
        <div className="flex items-center gap-3">
          {mlStatus?.status === 'healthy' ? (
            <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg text-sm font-medium">
              <CheckCircle className="w-4 h-4" />
              Operational
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg text-sm font-medium">
              <AlertCircle className="w-4 h-4" />
              {mlStatus ? 'Degraded' : 'Unavailable'}
            </div>
          )}
          {mlStatus?.modelId ? (
            <span className="text-xs text-slate-500">Model: {mlStatus.modelId} ({mlStatus.modelType})</span>
          ) : (
            <span className="text-xs text-slate-500">No production model — using rules + baselines</span>
          )}
        </div>
        {!mlStatus && (
          <p className="text-xs text-slate-400 mt-2">
            Set ML_SERVICE_URL environment variable to connect the ML service. The system continues working with rules and statistical baselines.
          </p>
        )}
      </div>

      {/* Current metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Reviewed Incidents"
          value={String(dbStats?.reviewedIncidents ?? '—')}
          sub="Total human reviews"
        />
        <MetricCard
          label="False Positive Rate"
          value={falsePositiveRate ? `${falsePositiveRate}%` : '—'}
          sub="Reviewed as false positive"
          color={falsePositiveRate && parseFloat(falsePositiveRate) > 20 ? 'text-amber-600' : 'text-slate-900'}
        />
        <MetricCard
          label="Total Transactions"
          value={dbStats?.totalTransactions.toLocaleString() ?? '—'}
          sub="In production database"
        />
        <MetricCard
          label="Open Incidents"
          value={String(dbStats?.openIncidents ?? '—')}
          sub="Awaiting review"
          color={dbStats && dbStats.openIncidents > 10 ? 'text-amber-600' : 'text-slate-900'}
        />
      </div>

      {/* Production model */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Production Model</h2>
          {productionModel && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">PRODUCTION</span>
          )}
        </div>
        <div className="p-5">
          {productionModel ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-slate-500">Model ID</p>
                  <p className="font-mono text-xs text-slate-700 mt-0.5 truncate">{productionModel.modelId}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Type</p>
                  <p className="font-medium text-slate-900 mt-0.5 capitalize">{productionModel.modelType?.replace('_', ' ')}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Training Samples</p>
                  <p className="font-medium text-slate-900 mt-0.5">{productionModel.sampleCount?.toLocaleString() ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Trained</p>
                  <p className="font-medium text-slate-900 mt-0.5">{productionModel.trainedAt ? timeAgo(productionModel.trainedAt) : '—'}</p>
                </div>
              </div>
              {productionModel.metrics && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-100">
                  {productionModel.metrics.rocAuc !== undefined && (
                    <div className="text-center bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-500">ROC AUC</p>
                      <p className="text-lg font-bold text-slate-900">{productionModel.metrics.rocAuc?.toFixed(3)}</p>
                    </div>
                  )}
                  {productionModel.metrics.precision !== undefined && (
                    <div className="text-center bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-500">Precision</p>
                      <p className="text-lg font-bold text-slate-900">{(productionModel.metrics.precision * 100).toFixed(1)}%</p>
                    </div>
                  )}
                  {productionModel.metrics.recall !== undefined && (
                    <div className="text-center bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-500">Recall</p>
                      <p className="text-lg font-bold text-slate-900">{(productionModel.metrics.recall * 100).toFixed(1)}%</p>
                    </div>
                  )}
                  {productionModel.metrics.falsePositiveRate !== undefined && (
                    <div className="text-center bg-slate-50 rounded-lg p-3">
                      <p className="text-xs text-slate-500">FP Rate</p>
                      <p className={cn('text-lg font-bold', productionModel.metrics.falsePositiveRate > 0.15 ? 'text-amber-600' : 'text-slate-900')}>
                        {(productionModel.metrics.falsePositiveRate * 100).toFixed(1)}%
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-6">
              <Brain className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-600 font-medium">No production model deployed</p>
              <p className="text-xs text-slate-400 mt-1">System uses deterministic rules + statistical baselines. ML will improve accuracy once trained.</p>
            </div>
          )}
        </div>
      </div>

      {/* Training controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-1">Train New Candidate Model</h2>
        <p className="text-xs text-slate-500 mb-4">
          Training uses reviewed incidents as labeled data. Requires ≥20 reviewed incidents.
          Candidate models go through quality gates before they can be deployed.
        </p>

        {!canTrain && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2.5 rounded-lg mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Need {20 - (dbStats?.reviewedIncidents ?? 0)} more reviewed incidents before training is available.</span>
          </div>
        )}

        {trainResult && (
          <div className={cn('text-xs px-3 py-2.5 rounded-lg mb-4 border',
            trainResult.startsWith('Error') ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'
          )}>
            {trainResult}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={triggerTraining}
            disabled={!canTrain || training}
            className="flex items-center gap-2 bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40 transition-colors"
          >
            {training ? <><RefreshCw className="w-4 h-4 animate-spin" />Training…</> : <><Brain className="w-4 h-4" />Train Candidate</>}
          </button>
        </div>

        <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-100">
          <p className="text-xs font-medium text-slate-700 mb-1">Quality gates required for deployment:</p>
          <ul className="text-xs text-slate-500 space-y-0.5">
            <li>• Minimum 100 training samples (Isolation Forest) or 200 (supervised)</li>
            <li>• False positive rate ≤ 15% (supervised only)</li>
            <li>• ROC AUC ≥ 0.65 (supervised only)</li>
            <li>• Candidate must not be worse than current production model</li>
          </ul>
        </div>
      </div>

      {/* Candidate models */}
      {candidateModels.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Candidate Models ({candidateModels.length})</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {candidateModels.map(model => (
              <div key={model.modelId} className="p-4">
                <button
                  onClick={() => setExpanded(expanded === model.modelId ? null : model.modelId)}
                  className="w-full flex items-center justify-between text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-slate-600">{model.modelId}</span>
                    <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">CANDIDATE</span>
                    <span className="text-xs text-slate-400">{model.sampleCount?.toLocaleString()} samples</span>
                  </div>
                  {expanded === model.modelId ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
                {expanded === model.modelId && model.metrics && (
                  <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                    {Object.entries(model.metrics).map(([k, v]) => (
                      typeof v === 'number' && (
                        <div key={k} className="bg-slate-50 rounded-lg p-2">
                          <p className="text-slate-500">{k}</p>
                          <p className="font-semibold text-slate-900">{typeof v === 'number' ? v.toFixed(4) : String(v)}</p>
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
        <Shield className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-800">
          <p className="font-medium mb-1">ML safety principles</p>
          <ul className="space-y-0.5 text-blue-700">
            <li>• Demo data is never used for production model training</li>
            <li>• Training uses time-aware validation (no future data leakage)</li>
            <li>• Candidate models must pass all quality gates before deployment</li>
            <li>• ML scores are combined with rules and baselines — never shown raw to users</li>
            <li>• ML failure does not break transaction analysis (graceful fallback)</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
