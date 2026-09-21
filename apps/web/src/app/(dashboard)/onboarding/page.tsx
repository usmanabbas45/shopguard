'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, Store, Upload, CheckCircle, ArrowRight, Building } from 'lucide-react'

type Step = 1 | 2 | 3

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [storeName, setStoreName] = useState('')
  const [storeAddress, setStoreAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function createStore() {
    if (!storeName.trim()) { setError('Store name is required'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: storeName.trim(), address: storeAddress.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setStep(3)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create store')
    }
    setLoading(false)
  }

  const steps = [
    { num: 1, label: 'Welcome' },
    { num: 2, label: 'First Store' },
    { num: 3, label: 'Import Data' },
  ]

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div key={s.num} className="flex items-center gap-2">
              <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-colors ${
                step > s.num ? 'bg-green-500 text-white' :
                step === s.num ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500'
              }`}>
                {step > s.num ? '✓' : s.num}
              </div>
              <span className={`text-xs font-medium ${step === s.num ? 'text-brand-700' : 'text-slate-400'}`}>{s.label}</span>
              {i < steps.length - 1 && <div className="w-8 h-px bg-slate-200 mx-1" />}
            </div>
          ))}
        </div>

        {/* Step 1: Welcome */}
        {step === 1 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
            <div className="w-14 h-14 bg-brand-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <ShieldCheck className="w-8 h-8 text-brand-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-3">Welcome to ShopGuard</h1>
            <p className="text-slate-600 mb-2 leading-relaxed">
              ShopGuard monitors your POS transaction data and automatically surfaces unusual activity for your review.
            </p>
            <p className="text-slate-500 text-sm mb-6">
              Setup takes about 2 minutes. You&apos;ll need a CSV export from your POS system.
            </p>
            <div className="space-y-3 text-left mb-8">
              {[
                'Import your CSV transaction data from any POS',
                'ShopGuard analyzes patterns automatically',
                'Unusual events surface for your review',
                'You make the final decision — always',
              ].map(item => (
                <div key={item} className="flex items-center gap-3 text-sm text-slate-700">
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                  {item}
                </div>
              ))}
            </div>
            <button
              onClick={() => setStep(2)}
              className="w-full flex items-center justify-center gap-2 bg-brand-600 text-white font-semibold py-3 rounded-xl hover:bg-brand-700 transition-colors"
            >
              Get started <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Step 2: Create store */}
        {step === 2 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 bg-brand-50 rounded-xl">
                <Building className="w-5 h-5 text-brand-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Create your first store</h2>
                <p className="text-sm text-slate-500">You can add more stores later</p>
              </div>
            </div>

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Store name *</label>
                <input
                  type="text"
                  value={storeName}
                  onChange={e => setStoreName(e.target.value)}
                  placeholder="e.g. Main Branch, Downtown Store"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Address (optional)</label>
                <input
                  type="text"
                  value={storeAddress}
                  onChange={e => setStoreAddress(e.target.value)}
                  placeholder="e.g. Block 5, Clifton, Karachi"
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(1)} className="px-4 py-2.5 border border-slate-200 text-slate-600 text-sm rounded-xl hover:bg-slate-50 transition-colors">
                Back
              </button>
              <button
                onClick={createStore}
                disabled={loading || !storeName.trim()}
                className="flex-1 flex items-center justify-center gap-2 bg-brand-600 text-white font-semibold py-2.5 rounded-xl hover:bg-brand-700 disabled:opacity-40 transition-colors"
              >
                {loading ? 'Creating…' : <>Create store <ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Import data */}
        {step === 3 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
            <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-3">Store created!</h2>
            <p className="text-slate-600 mb-6 leading-relaxed">
              Now import your transaction history. ShopGuard will analyze it automatically and surface any unusual patterns.
            </p>

            <div className="bg-brand-50 border border-brand-100 rounded-xl p-4 text-left mb-6">
              <p className="text-sm font-medium text-brand-900 mb-1">What to import</p>
              <p className="text-xs text-brand-700">A CSV export from your POS containing transactions with dates, amounts, employee names, and payment methods. ShopGuard auto-detects the column format.</p>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => router.push('/import')}
                className="w-full flex items-center justify-center gap-2 bg-brand-600 text-white font-semibold py-3 rounded-xl hover:bg-brand-700 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Import transaction data
              </button>
              <button
                onClick={() => router.push('/dashboard')}
                className="w-full text-slate-500 text-sm py-2 hover:text-slate-700 transition-colors"
              >
                Skip for now → go to dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
