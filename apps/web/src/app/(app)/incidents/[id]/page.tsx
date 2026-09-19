'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AlertTriangle, ArrowLeft, User, Store, Clock, CheckCircle,
  XCircle, HelpCircle, Info, ChevronDown, ChevronUp, Shield
} from 'lucide-react'
import { getRiskColor, getStatusColor, formatDateTime, timeAgo, cn } from '@/lib/utils'

interface Incident {
  id: string
  title: string
  summary: string
  riskLevel: string
  severity: string
  status: string
  type: string
  whyFlagged: string[]
  ruleIds: string[]
  createdAt: string
  updatedAt: string
  followUpCount: number
  employee?: { id: string; name: string; role?: string }
  store?: { id: string; name: string }
  register?: { id: string; name: string }
  evidence?: { id: string; type: string; description: string; severity: string; score: number }[]
  reviews?: { id: string; label: string; notes?: string; createdAt: string }[]
}

const REVIEW_LABELS = [
  { value: 'VALID_INCIDENT', label: 'Mark as Valid Incident', icon: AlertTriangle, color: 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100' },
  { value: 'FALSE_POSITIVE', label: 'Mark as False Positive', icon: XCircle, color: 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100' },
  { value: 'NEEDS_INVESTIGATION', label: 'Needs Further Investigation', icon: HelpCircle, color: 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100' },
  { value: 'NOT_ENOUGH_EVIDENCE', label: 'Not Enough Evidence', icon: Info, color: 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100' },
]

const REVIEW_LABEL_NAMES: Record<string, string> = {
  VALID_INCIDENT: 'Valid Incident',
  FALSE_POSITIVE: 'False Positive',
  NEEDS_INVESTIGATION: 'Needs Investigation',
  NOT_ENOUGH_EVIDENCE: 'Not Enough Evidence',
}

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [incident, setIncident] = useState<Incident | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState(false)
  const [selectedLabel, setSelectedLabel] = useState('')
  const [notes, setNotes] = useState('')
  const [showReviewForm, setShowReviewForm] = useState(false)
  const [reviewSuccess, setReviewSuccess] = useState(false)
  const [whyExpanded, setWhyExpanded] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/incidents/${id}`)
        const data = await res.json()
        if (res.ok) setIncident(data.incident)
      } catch {}
      setLoading(false)
    }
    load()
  }, [id])

  async function submitReview() {
    if (!selectedLabel) return
    setReviewing(true)
    try {
      const res = await fetch(`/api/incidents/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: selectedLabel, notes: notes.trim() || undefined }),
      })
      if (res.ok) {
        setReviewSuccess(true)
        setShowReviewForm(false)
        // Refresh incident
        const r2 = await fetch(`/api/incidents/${id}`)
        const d2 = await r2.json()
        if (r2.ok) setIncident(d2.incident)
      }
    } catch {}
    setReviewing(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!incident) {
    return (
      <div className="text-center py-20">
        <AlertTriangle className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-600 font-medium">Incident not found</p>
        <Link href="/incidents" className="text-sm text-brand-600 mt-2 inline-block hover:underline">← Back to incidents</Link>
      </div>
    )
  }

  const isResolved = incident.status === 'RESOLVED' || incident.status === 'DISMISSED'
  const latestReview = incident.reviews?.[incident.reviews.length - 1]

  return (
    <div className="max-w-3xl space-y-5">
      {/* Back */}
      <Link href="/incidents" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        All incidents
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={cn('inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold border', getRiskColor(incident.riskLevel))}>
              {incident.riskLevel} RISK
            </span>
            <span className={cn('text-xs px-2 py-0.5 rounded font-medium', getStatusColor(incident.status))}>
              {incident.status.replace('_', ' ')}
            </span>
          </div>
          <p className="text-xs text-slate-400 flex-shrink-0">{timeAgo(incident.createdAt)}</p>
        </div>

        <h1 className="text-xl font-bold text-slate-900 mb-2">{incident.title}</h1>
        <p className="text-slate-600 text-sm leading-relaxed">{incident.summary}</p>

        {/* Meta */}
        <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-slate-100 text-sm text-slate-600">
          {incident.employee && (
            <div className="flex items-center gap-1.5">
              <User className="w-4 h-4 text-slate-400" />
              <Link href={`/employees/${incident.employee.id}`} className="hover:text-brand-600 font-medium">
                {incident.employee.name}
              </Link>
              {incident.employee.role && <span className="text-slate-400">· {incident.employee.role}</span>}
            </div>
          )}
          {incident.store && (
            <div className="flex items-center gap-1.5">
              <Store className="w-4 h-4 text-slate-400" />
              <Link href={`/stores/${incident.store.id}`} className="hover:text-brand-600 font-medium">
                {incident.store.name}
              </Link>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-slate-400" />
            <span>{formatDateTime(incident.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* Why flagged */}
      <div className="bg-white rounded-xl border border-slate-200">
        <button
          onClick={() => setWhyExpanded(e => !e)}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <h2 className="text-sm font-semibold text-slate-900">Why this was flagged</h2>
          {whyExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>
        {whyExpanded && (
          <div className="px-5 pb-5 space-y-2">
            {incident.whyFlagged.map((reason, i) => (
              <div key={i} className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-900">{reason}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Evidence */}
      {incident.evidence && incident.evidence.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Evidence signals</h2>
          <div className="space-y-2">
            {incident.evidence.map(ev => (
              <div key={ev.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0',
                  ev.severity === 'HIGH' ? 'bg-red-500' : ev.severity === 'MEDIUM' ? 'bg-amber-500' : 'bg-green-500'
                )} />
                <p className="text-sm text-slate-700">{ev.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Principle disclaimer */}
      <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 flex items-start gap-3">
        <Shield className="w-4 h-4 text-brand-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-brand-800 leading-relaxed">
          ShopGuard flags unusual patterns for your review. This is not an accusation. You have access to information we do not — only you can make the final determination after your own investigation.
        </p>
      </div>

      {/* Review section */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-1">Review this incident</h2>
        <p className="text-xs text-slate-500 mb-4">Your review helps ShopGuard learn and improve future detection.</p>

        {reviewSuccess && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg mb-4">
            <CheckCircle className="w-4 h-4" />
            Review saved successfully.
          </div>
        )}

        {latestReview && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-4 h-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">
                Reviewed: {REVIEW_LABEL_NAMES[latestReview.label] ?? latestReview.label}
              </span>
            </div>
            {latestReview.notes && <p className="text-xs text-slate-500 mt-1">{latestReview.notes}</p>}
            <p className="text-xs text-slate-400 mt-1">{timeAgo(latestReview.createdAt)}</p>
          </div>
        )}

        {!isResolved && !showReviewForm && (
          <button
            onClick={() => setShowReviewForm(true)}
            className="inline-flex items-center gap-2 bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors"
          >
            Add Review
          </button>
        )}

        {showReviewForm && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {REVIEW_LABELS.map(({ value, label, icon: Icon, color }) => (
                <button
                  key={value}
                  onClick={() => setSelectedLabel(value)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors text-left',
                    selectedLabel === value ? color.replace('hover:', '') : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {label}
                </button>
              ))}
            </div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional notes — what did you find? (not stored for employee records)"
              rows={3}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={submitReview}
                disabled={!selectedLabel || reviewing}
                className="bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40 transition-colors"
              >
                {reviewing ? 'Saving…' : 'Save Review'}
              </button>
              <button
                onClick={() => setShowReviewForm(false)}
                className="text-slate-500 text-sm px-3 py-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
