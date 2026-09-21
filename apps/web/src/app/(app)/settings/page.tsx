'use client'

import { useState, useEffect } from 'react'
import { Settings, Bell, Shield, Building, Users, Check, AlertCircle, Loader2, Link2, RefreshCw, X } from 'lucide-react'
import { SUPPORTED_CURRENCIES, TIMEZONE_GROUPS } from '@/lib/money'

const RULE_LIST = [
  { id: 'void_after_cash', name: 'Void After Cash Payment', desc: 'Flags voids that occur shortly after a cash payment on the same register', defaultOn: true },
  { id: 'no_sale_drawer', name: 'No-Sale Drawer Opening', desc: 'Flags cash drawer openings with no associated sale', defaultOn: true },
  { id: 'repeated_voids', name: 'Repeated Voids', desc: 'Flags employees whose void rate significantly exceeds their personal baseline', defaultOn: true },
  { id: 'large_refund', name: 'Large Refund', desc: 'Flags refunds that are unusually high relative to store average', defaultOn: true },
  { id: 'rapid_sale_refund', name: 'Rapid Sale-Refund Sequence', desc: 'Flags refunds that occur very shortly after a sale', defaultOn: true },
  { id: 'excessive_discount', name: 'Excessive Discount', desc: 'Flags discounts that significantly exceed the store or employee baseline', defaultOn: true },
  { id: 'price_override', name: 'Price Override', desc: 'Flags manual price overrides for review', defaultOn: true },
  { id: 'after_hours', name: 'After-Hours Transaction', desc: 'Flags transactions outside normal operating hours', defaultOn: true },
  { id: 'unusual_amount', name: 'Unusual Transaction Amount', desc: 'Flags amounts that are statistical outliers for this store', defaultOn: false },
  { id: 'cash_variance', name: 'Cash Variance', desc: 'Flags significant discrepancies between expected and counted cash', defaultOn: true },
]

const ALLOWED_LOCALES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-AU', label: 'English (Australia)' },
  { value: 'en-CA', label: 'English (Canada)' },
  { value: 'en-PK', label: 'English (Pakistan)' },
  { value: 'en-IN', label: 'English (India)' },
  { value: 'en-ZA', label: 'English (South Africa)' },
  { value: 'de-DE', label: 'German (Germany)' },
  { value: 'fr-FR', label: 'French (France)' },
  { value: 'fr-CA', label: 'French (Canada)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'es-MX', label: 'Spanish (Mexico)' },
  { value: 'ar-AE', label: 'Arabic (UAE)' },
  { value: 'ar-SA', label: 'Arabic (Saudi Arabia)' },
  { value: 'ur-PK', label: 'Urdu (Pakistan)' },
  { value: 'hi-IN', label: 'Hindi (India)' },
  { value: 'zh-CN', label: 'Chinese Simplified' },
  { value: 'zh-TW', label: 'Chinese Traditional' },
  { value: 'ja-JP', label: 'Japanese' },
  { value: 'ko-KR', label: 'Korean' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'tr-TR', label: 'Turkish' },
  { value: 'id-ID', label: 'Indonesian' },
  { value: 'ms-MY', label: 'Malay' },
  { value: 'th-TH', label: 'Thai' },
  { value: 'vi-VN', label: 'Vietnamese' },
  { value: 'sw-KE', label: 'Swahili (Kenya)' },
]

interface OrgSettings {
  id: string
  name: string
  currency: string
  timezone: string
  locale: string
  country: string | null
  countryCode: string | null
  businessType: string | null
  isDemo: boolean
}

type Tab = 'organization' | 'notifications' | 'rules' | 'team' | 'integrations'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('organization')
  const [rules, setRules] = useState<Record<string, boolean>>(
    Object.fromEntries(RULE_LIST.map(r => [r.id, r.defaultOn]))
  )

  // Shopify integration state
  const [shopify, setShopify] = useState<{
    connected: boolean; shopDomain?: string; status?: string;
    lastSyncAt?: string; lastWebhookAt?: string; syncStatus?: string;
    syncCounts?: { discovered: number; accepted: number; duplicates: number; rejected: number };
    syncError?: string | null;
    webhookHealthy?: boolean;
    webhookMessage?: string | null;
  } | null>(null)
  const [shopifyLoading, setShopifyLoading] = useState(false)
  const [shopInput, setShopInput] = useState('')
  const [shopifyMsg, setShopifyMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Load Shopify status; check URL params for post-OAuth feedback
  useEffect(() => {
    fetch('/api/integrations/shopify')
      .then(r => r.json())
      .then(data => setShopify(data))
      .catch(() => {})
    // Show post-OAuth success message from URL params
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const shopifyParam = params.get('shopify')
      if (shopifyParam === 'connected_sync_queued') setShopifyMsg({ type: 'ok', text: 'Shopify connected — initial sync queued (runs every 5 minutes via cron)' })
      else if (shopifyParam === 'connected_degraded') setShopifyMsg({ type: 'err', text: 'Shopify connected but webhook setup needs attention. Use Sync now to import data.' })
      else if (shopifyParam === 'connected') setShopifyMsg({ type: 'ok', text: 'Shopify connected successfully' })
    }
  }, [])

  async function handleShopifyConnect() {
    if (!shopInput.trim()) return
    const domain = shopInput.trim().toLowerCase()
    setShopifyLoading(true)
    setShopifyMsg(null)
    window.location.href = `/api/integrations/shopify/install?shop=${encodeURIComponent(domain)}`
  }

  async function handleShopifySync() {
    setShopifyLoading(true)
    setShopifyMsg(null)
    try {
      const res = await fetch('/api/integrations/shopify/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) setShopifyMsg({ type: 'err', text: data.error ?? 'Sync failed' })
      else setShopifyMsg({ type: 'ok', text: data.message ?? 'Sync started' })
    } catch { setShopifyMsg({ type: 'err', text: 'Network error' }) }
    finally { setShopifyLoading(false) }
  }

  async function handleShopifyDisconnect() {
    if (!confirm('Disconnect Shopify? Historical transactions will be preserved.')) return
    setShopifyLoading(true)
    try {
      const res = await fetch('/api/integrations/shopify', { method: 'DELETE' })
      if (res.ok) { setShopify({ connected: false }); setShopifyMsg({ type: 'ok', text: 'Shopify disconnected' }) }
      else setShopifyMsg({ type: 'err', text: 'Disconnect failed' })
    } catch { setShopifyMsg({ type: 'err', text: 'Network error' }) }
    finally { setShopifyLoading(false) }
  }

  // Org settings state
  const [org, setOrg] = useState<OrgSettings | null>(null)
  const [form, setForm] = useState({ currency: '', timezone: '', locale: '', country: '', name: '', businessType: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load org settings on mount
  useEffect(() => {
    fetch('/api/settings/organization')
      .then(r => r.json())
      .then(data => {
        if (data.org) {
          setOrg(data.org)
          setForm({
            currency: data.org.currency ?? 'USD',
            timezone: data.org.timezone ?? 'UTC',
            locale: data.org.locale ?? 'en-US',
            country: data.org.country ?? '',
            name: data.org.name ?? '',
            businessType: data.org.businessType ?? '',
          })
        }
      })
      .catch(() => setError('Failed to load settings'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSaveOrg() {
    if (!org || org.isDemo) return
    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/settings/organization', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name || undefined,
          currency: form.currency || undefined,
          timezone: form.timezone || undefined,
          locale: form.locale || undefined,
          country: form.country || null,
          businessType: form.businessType || null,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.issues
          ? data.issues.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join(', ')
          : data.error ?? 'Save failed')
        return
      }

      setOrg(data.org)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'organization', label: 'Organization', icon: Building },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'rules', label: 'Detection Rules', icon: Shield },
    { id: 'team', label: 'Team', icon: Users },
    { id: 'integrations', label: 'Integrations', icon: Link2 },
  ]

  // Group currencies by region for the dropdown
  type CurrencyEntry = { code: string; name: string; symbol: string; region: string }
  const currencyRegions = (SUPPORTED_CURRENCIES as unknown as CurrencyEntry[]).reduce<Record<string, CurrencyEntry[]>>((acc, cur) => {
    if (!acc[cur.region]) acc[cur.region] = []
    acc[cur.region].push(cur)
    return acc
  }, {})

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Configure ShopGuard for your organization.</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === id
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Organization Tab */}
      {activeTab === 'organization' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
          {loading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading settings...
            </div>
          ) : (
            <>
              {org?.isDemo && (
                <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  Demo organization — settings are read-only
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* Organization name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Organization name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  disabled={org?.isDemo}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>

              {/* Currency */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Currency <span className="text-slate-400 font-normal">(ISO 4217)</span>
                </label>
                <select
                  value={form.currency}
                  onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                  disabled={org?.isDemo}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  {Object.entries(currencyRegions).map(([region, currencies]) => (
                    <optgroup key={region} label={region}>
                      {(currencies as CurrencyEntry[]).map(cur => (
                        <option key={cur.code} value={cur.code}>{cur.code} — {cur.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">Used for displaying monetary amounts. Does not convert values.</p>
              </div>

              {/* Timezone */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Timezone <span className="text-slate-400 font-normal">(IANA identifier)</span>
                </label>
                <select
                  value={form.timezone}
                  onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
                  disabled={org?.isDemo}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="UTC">UTC — Coordinated Universal Time</option>
                  {TIMEZONE_GROUPS.map(group => (
                    <optgroup key={group.region} label={group.region}>
                      {group.timezones.map(tz => (
                        <option key={tz.id} value={tz.id}>{tz.id} — {tz.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">All timestamps are stored in UTC. This setting controls display and business-hours calculations.</p>
              </div>

              {/* Locale */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Display language <span className="text-slate-400 font-normal">(BCP 47 locale)</span>
                </label>
                <select
                  value={form.locale}
                  onChange={e => setForm(f => ({ ...f, locale: e.target.value }))}
                  disabled={org?.isDemo}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  {ALLOWED_LOCALES.map(l => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>

              {/* Country */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Country <span className="text-slate-400 font-normal">(ISO 3166-1 alpha-2)</span>
                </label>
                <input
                  type="text"
                  value={form.country}
                  onChange={e => setForm(f => ({ ...f, country: e.target.value.toUpperCase().slice(0, 2) }))}
                  disabled={org?.isDemo}
                  placeholder="e.g. US, GB, AE, PK"
                  maxLength={2}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400 uppercase"
                />
              </div>

              {/* Business type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Business type</label>
                <input
                  type="text"
                  value={form.businessType}
                  onChange={e => setForm(f => ({ ...f, businessType: e.target.value }))}
                  disabled={org?.isDemo}
                  placeholder="e.g. Retail chain, Supermarket, Pharmacy"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>

              {!org?.isDemo && (
                <button
                  onClick={handleSaveOrg}
                  disabled={saving}
                  className="flex items-center gap-2 bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-60"
                >
                  {saving ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />Saving...</>
                  ) : saved ? (
                    <><Check className="w-4 h-4" />Saved</>
                  ) : (
                    'Save changes'
                  )}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Notifications Tab */}
      {activeTab === 'notifications' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Notification preferences</h2>
          <div className="space-y-3">
            {[
              { label: 'High priority incidents', desc: 'Immediate notification for HIGH and CRITICAL incidents', defaultOn: true },
              { label: 'Daily summary report', desc: 'End-of-day report with incident and transaction summary', defaultOn: true },
              { label: 'Follow-up reminders', desc: 'Reminders for open incidents that need review', defaultOn: true },
              { label: 'System alerts', desc: 'Alerts for service health issues and ML model status', defaultOn: false },
            ].map((item, i) => (
              <label key={i} className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" defaultChecked={item.defaultOn} className="mt-0.5 accent-brand-600" />
                <div>
                  <div className="text-sm font-medium text-slate-800">{item.label}</div>
                  <div className="text-xs text-slate-500">{item.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Detection Rules Tab */}
      {activeTab === 'rules' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Detection rules</h2>
            <p className="text-xs text-slate-500 mt-0.5">Enable or disable specific fraud detection rules for your organization.</p>
          </div>
          <div className="space-y-3">
            {RULE_LIST.map(rule => (
              <div key={rule.id} className="flex items-start justify-between gap-4 py-2 border-b border-slate-100 last:border-0">
                <div>
                  <div className="text-sm font-medium text-slate-800">{rule.name}</div>
                  <div className="text-xs text-slate-500">{rule.desc}</div>
                </div>
                <button
                  onClick={() => setRules(prev => ({ ...prev, [rule.id]: !prev[rule.id] }))}
                  className={`flex-shrink-0 w-10 h-5 rounded-full transition-colors ${rules[rule.id] ? 'bg-brand-600' : 'bg-slate-200'}`}
                  role="switch"
                  aria-checked={rules[rule.id]}
                >
                  <span className={`block w-4 h-4 rounded-full bg-white shadow mx-0.5 transition-transform ${rules[rule.id] ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team Tab */}
      {activeTab === 'team' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Team members</h2>
          <p className="text-sm text-slate-500">Team management is coming soon. Contact support to add or remove team members.</p>
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === 'integrations' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <span className="text-lg font-bold text-green-700">S</span>
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">Shopify</h2>
                <p className="text-xs text-slate-500">ShopGuard analyzes your Shopify transaction activity for unusual patterns. It does not replace Shopify.</p>
              </div>
              <div className="ml-auto">
                {shopify?.connected ? (
                  <span className="inline-flex items-center gap-1.5 bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-1 rounded-full">Connected</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-600 text-xs font-semibold px-2.5 py-1 rounded-full">Not connected</span>
                )}
              </div>
            </div>

            {shopifyMsg && (
              <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${shopifyMsg.type === 'ok' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {shopifyMsg.text}
              </div>
            )}

            {shopify?.connected ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-slate-500">Store:</span> <span className="font-medium">{shopify.shopDomain}</span></div>
                  <div><span className="text-slate-500">Status:</span> <span className="font-medium">{shopify.syncStatus ?? 'IDLE'}</span></div>
                  <div><span className="text-slate-500">Last sync:</span> <span className="font-medium">{shopify.lastSyncAt ? new Date(shopify.lastSyncAt).toLocaleString() : 'Never'}</span></div>
                  <div><span className="text-slate-500">Last webhook:</span> <span className="font-medium">{shopify.lastWebhookAt ? new Date(shopify.lastWebhookAt).toLocaleString() : 'Never'}</span></div>
                </div>
                {shopify.webhookMessage && (
                  <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {shopify.webhookMessage}
                  </div>
                )}
                <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 flex items-center gap-2">
                  {shopify.syncStatus === 'QUEUED' && <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Initial sync queued — runs every 5 minutes</span></>}
                  {shopify.syncStatus === 'RUNNING' && <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Syncing Shopify orders...</span></>}
                  {shopify.syncStatus === 'COMPLETED' && <span>✓ Sync complete</span>}
                  {shopify.syncStatus === 'FAILED' && <span className="text-red-600">Sync failed — click Sync now to resume</span>}
                  {shopify.syncStatus === 'IDLE' && <span>Not synced yet</span>}
                </div>
                {shopify.syncCounts && shopify.syncCounts.discovered > 0 && (
                  <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                    {shopify.syncCounts.accepted} orders imported · {shopify.syncCounts.duplicates} duplicates skipped · {shopify.syncCounts.rejected} rejected
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={handleShopifySync} disabled={shopifyLoading} className="flex items-center gap-2 text-sm font-medium bg-brand-600 text-white px-3 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-60">
                    {shopifyLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}Sync now
                  </button>
                  <button onClick={handleShopifyDisconnect} disabled={shopifyLoading} className="flex items-center gap-2 text-sm font-medium bg-red-50 text-red-700 border border-red-200 px-3 py-2 rounded-lg hover:bg-red-100 disabled:opacity-60">
                    <X className="w-4 h-4" />Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">Enter your Shopify store domain to connect:</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={shopInput}
                    onChange={e => setShopInput(e.target.value)}
                    placeholder="yourstore.myshopify.com"
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button onClick={handleShopifyConnect} disabled={shopifyLoading || !shopInput.trim()} className="flex items-center gap-2 text-sm font-medium bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-60">
                    {shopifyLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}Connect
                  </button>
                </div>
                <p className="text-xs text-slate-400">You will be redirected to Shopify to authorize ShopGuard. Scopes requested: read_orders, read_locations.</p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Other integrations</h3>
            {['Square', 'Lightspeed', 'Toast', 'Clover'].map(name => (
              <div key={name} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <span className="text-sm text-slate-700">{name}</span>
                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Coming soon</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

