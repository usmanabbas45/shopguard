'use client'

import { useState, useCallback } from 'react'
import { Upload, FileText, CheckCircle, AlertCircle, ArrowRight, X, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

type Step = 'upload' | 'mapping' | 'importing' | 'done'

interface InspectResult {
  headers: string[]
  sampleRows: Record<string, string>[]
  detectedMappings: { csvColumn: string; normalizedField: string; confidence: number }[]
  ambiguousFields: string[]
  missingRequired: string[]
  totalRows: number
}

const FIELD_LABELS: Record<string, string> = {
  externalTransactionId: 'Transaction ID *',
  timestamp: 'Date / Time *',
  grossAmount: 'Gross Amount *',
  netAmount: 'Net Amount',
  employeeId: 'Employee Name',
  storeId: 'Store / Branch',
  registerId: 'Register / Till',
  paymentMethod: 'Payment Method',
  discountAmount: 'Discount Amount',
  discountPercent: 'Discount %',
  refundAmount: 'Refund Amount',
  isVoid: 'Void Flag',
  isRefund: 'Refund Flag',
  isNoSale: 'No-Sale Flag',
  itemCount: 'Item Count',
}

export default function ImportPage() {
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(null)
  const [columnMappings, setColumnMappings] = useState<Record<string, string>>({})
  const [storeId, setStoreId] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errorCount: number; errors: string[] } | null>(null)
  const [error, setError] = useState('')

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f?.name.endsWith('.csv')) setFile(f)
    else setError('Please upload a CSV file')
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setFile(f)
  }

  async function inspectFile() {
    if (!file) return
    setInspecting(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/imports/inspect', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setInspectResult(data.result)

      // Build initial mapping from detected
      const mappings: Record<string, string> = {}
      for (const m of data.result.detectedMappings) {
        mappings[m.normalizedField] = m.csvColumn
      }
      setColumnMappings(mappings)
      setStep('mapping')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to read file')
    }
    setInspecting(false)
  }

  async function runImport() {
    if (!file || !inspectResult) return
    setImporting(true)
    setStep('importing')
    setError('')
    try {
      const text = await file.text()
      const res = await fetch('/api/imports/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          csvContent: text,
          columnMappings,
          storeId: storeId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setImportResult(data)
      setStep('done')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setStep('mapping')
    }
    setImporting(false)
  }

  function reset() {
    setFile(null)
    setStep('upload')
    setInspectResult(null)
    setColumnMappings({})
    setImportResult(null)
    setError('')
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Import Transaction Data</h1>
        <p className="text-sm text-slate-500 mt-0.5">Upload a CSV export from your POS system. ShopGuard detects columns automatically.</p>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-2 text-xs font-medium">
        {(['upload', 'mapping', 'importing', 'done'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={cn(
              'flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold transition-colors',
              step === s ? 'bg-brand-600 text-white' :
                ['upload', 'mapping', 'importing', 'done'].indexOf(step) > i ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-500'
            )}>
              {['upload', 'mapping', 'importing', 'done'].indexOf(step) > i ? '✓' : i + 1}
            </div>
            <span className={step === s ? 'text-brand-700' : 'text-slate-400'}>
              {s === 'upload' ? 'Upload' : s === 'mapping' ? 'Map columns' : s === 'importing' ? 'Importing' : 'Complete'}
            </span>
            {i < 3 && <div className="w-8 h-px bg-slate-200" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Step: Upload */}
      {step === 'upload' && (
        <div className="space-y-4">
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={cn(
              'border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer',
              dragging ? 'border-brand-400 bg-brand-50' : 'border-slate-300 bg-white hover:border-brand-300 hover:bg-slate-50'
            )}
            onClick={() => document.getElementById('csv-input')?.click()}
          >
            <Upload className="w-8 h-8 text-slate-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-700 mb-1">
              {file ? file.name : 'Drop your CSV file here'}
            </p>
            <p className="text-xs text-slate-400">
              {file ? `${(file.size / 1024).toFixed(1)} KB · Click to change` : 'or click to browse — max 50MB'}
            </p>
            <input id="csv-input" type="file" accept=".csv,.txt" className="hidden" onChange={handleFileChange} />
          </div>

          {file && (
            <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
              <FileText className="w-5 h-5 text-green-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-green-800">{file.name}</p>
                <p className="text-xs text-green-600">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
              <button onClick={() => setFile(null)} className="text-green-600 hover:text-green-800">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <button
            onClick={inspectFile}
            disabled={!file || inspecting}
            className="w-full flex items-center justify-center gap-2 bg-brand-600 text-white font-semibold py-3 rounded-xl hover:bg-brand-700 disabled:opacity-40 transition-colors"
          >
            {inspecting ? <><RefreshCw className="w-4 h-4 animate-spin" />Analyzing file…</> : <>Continue <ArrowRight className="w-4 h-4" /></>}
          </button>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <p className="text-xs font-medium text-slate-700 mb-2">Supported column names (examples)</p>
            <div className="grid grid-cols-2 gap-1 text-xs text-slate-500">
              <span>Transaction ID, Txn ID, Receipt No</span>
              <span>Date, Transaction Date, Created At</span>
              <span>Amount, Total, Net Total, Sale Amount</span>
              <span>Employee, Staff, Cashier</span>
              <span>Store, Branch, Location, Outlet</span>
              <span>Register, Terminal, Till, Counter</span>
              <span>Payment Method, Pay Type, Tender</span>
              <span>Void, Voided, Refund, Discount</span>
            </div>
          </div>
        </div>
      )}

      {/* Step: Mapping */}
      {step === 'mapping' && inspectResult && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-900">Column mapping</h2>
              <div className="text-xs text-slate-500">
                {inspectResult.totalRows.toLocaleString()} rows detected · {inspectResult.headers.length} columns
              </div>
            </div>

            {inspectResult.missingRequired.length > 0 && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2.5 rounded-lg mb-4">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <strong>Required fields not detected:</strong> {inspectResult.missingRequired.join(', ')}<br />
                  Please map them manually below.
                </div>
              </div>
            )}

            <div className="space-y-3">
              {Object.entries(FIELD_LABELS).map(([field, label]) => {
                const detected = inspectResult.detectedMappings.find(m => m.normalizedField === field)
                const isRequired = label.endsWith('*')
                return (
                  <div key={field} className="flex items-center gap-3">
                    <div className="w-40 flex-shrink-0">
                      <span className="text-xs font-medium text-slate-700">{label}</span>
                      {detected && <span className="ml-1 text-xs text-green-600">✓</span>}
                    </div>
                    <select
                      value={columnMappings[field] ?? ''}
                      onChange={e => setColumnMappings(prev => ({
                        ...prev,
                        [field]: e.target.value,
                      }))}
                      className={cn(
                        'flex-1 text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500',
                        isRequired && !columnMappings[field] ? 'border-red-300' : 'border-slate-200'
                      )}
                    >
                      <option value="">— not mapped —</option>
                      {inspectResult.headers.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                    {columnMappings[field] && inspectResult.sampleRows[0] && (
                      <span className="text-xs text-slate-400 w-28 truncate flex-shrink-0" title={inspectResult.sampleRows[0][columnMappings[field]]}>
                        eg: {inspectResult.sampleRows[0][columnMappings[field]]}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Preview */}
          {inspectResult.sampleRows.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Data preview (first 3 rows)</h2>
              <div className="overflow-x-auto">
                <table className="text-xs w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      {inspectResult.headers.slice(0, 8).map(h => (
                        <th key={h} className="text-left py-1.5 pr-4 font-medium text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {inspectResult.sampleRows.slice(0, 3).map((row, i) => (
                      <tr key={i} className="border-b border-slate-50">
                        {inspectResult.headers.slice(0, 8).map(h => (
                          <td key={h} className="py-1.5 pr-4 text-slate-700 whitespace-nowrap max-w-28 truncate">{row[h] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={reset}
              className="px-4 py-2.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={runImport}
              disabled={!columnMappings.timestamp || !columnMappings.grossAmount}
              className="flex-1 flex items-center justify-center gap-2 bg-brand-600 text-white font-semibold py-2.5 rounded-xl hover:bg-brand-700 disabled:opacity-40 transition-colors"
            >
              Import {inspectResult.totalRows.toLocaleString()} Transactions
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step: Importing */}
      {step === 'importing' && (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <RefreshCw className="w-10 h-10 text-brand-600 mx-auto mb-4 animate-spin" />
          <p className="text-lg font-semibold text-slate-900 mb-2">Importing transactions…</p>
          <p className="text-sm text-slate-500">Processing rows, detecting employees and stores. This may take a moment.</p>
        </div>
      )}

      {/* Step: Done */}
      {step === 'done' && importResult && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 bg-green-100 rounded-full">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Import complete</h2>
                <p className="text-sm text-slate-500">Data has been imported and analysis is running.</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-5">
              <div className="text-center p-4 bg-green-50 rounded-xl border border-green-200">
                <p className="text-2xl font-bold text-green-700">{importResult.imported.toLocaleString()}</p>
                <p className="text-xs text-green-600 mt-1">Imported</p>
              </div>
              <div className="text-center p-4 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-2xl font-bold text-slate-600">{importResult.skipped.toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-1">Skipped</p>
              </div>
              <div className={cn('text-center p-4 rounded-xl border', importResult.errorCount > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200')}>
                <p className={cn('text-2xl font-bold', importResult.errorCount > 0 ? 'text-red-600' : 'text-slate-600')}>
                  {importResult.errorCount.toLocaleString()}
                </p>
                <p className={cn('text-xs mt-1', importResult.errorCount > 0 ? 'text-red-500' : 'text-slate-500')}>Errors</p>
              </div>
            </div>

            {importResult.errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                <p className="text-xs font-medium text-red-700 mb-2">Import issues (first 20):</p>
                <ul className="space-y-1">
                  {importResult.errors.slice(0, 20).map((e, i) => (
                    <li key={i} className="text-xs text-red-600">{e}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-sm text-slate-600 mb-5">
              Baselines are being calculated in the background. Unusual activity will appear in the Incidents section shortly.
            </p>

            <div className="flex gap-3">
              <a href="/dashboard" className="flex-1 flex items-center justify-center gap-2 bg-brand-600 text-white font-semibold py-2.5 rounded-xl hover:bg-brand-700 transition-colors text-sm">
                Go to Dashboard <ArrowRight className="w-4 h-4" />
              </a>
              <button
                onClick={reset}
                className="px-4 py-2.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition-colors"
              >
                Import more
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
