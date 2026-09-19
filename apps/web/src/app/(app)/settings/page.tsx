'use client'

import { useState } from 'react'
import { Settings, Bell, Shield, Building, Users, ChevronRight, Check } from 'lucide-react'

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

type Tab = 'organization' | 'notifications' | 'rules' | 'team'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('organization')
  const [rules, setRules] = useState<Record<string, boolean>>(
    Object.fromEntries(RULE_LIST.map(r => [r.id, r.defaultOn]))
  )
  const [saved, setSaved] = useState(false)

  function toggleRule(id: string) {
    setRules(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'organization', label: 'Organization', icon: Building },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'rules', label: 'Detection Rules', icon: Shield },
    { id: 'team', label: 'Team', icon: Users },
  ]

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Configure ShopGuard for your organization</p>
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

      {/* Organization tab */}
      {activeTab === 'organization' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
          <h2 className="text-sm font-semibold text-slate-900">Organization settings</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Organization name</label>
              <input defaultValue="Demo Organization" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Currency</label>
              <select defaultValue="PKR" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="PKR">PKR — Pakistani Rupee</option>
                <option value="USD">USD — US Dollar</option>
                <option value="EUR">EUR — Euro</option>
                <option value="GBP">GBP — British Pound</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Timezone</label>
              <select defaultValue="Asia/Karachi" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="Asia/Karachi">Asia/Karachi (PKT)</option>
                <option value="UTC">UTC</option>
                <option value="Asia/Dubai">Asia/Dubai (GST)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Business type</label>
              <select className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option>Electronics / Mobile Shop</option>
                <option>Convenience Store</option>
                <option>Pharmacy</option>
                <option>Restaurant</option>
                <option>Clothing</option>
              </select>
            </div>
          </div>
          <button onClick={handleSave} className="flex items-center gap-2 bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors">
            {saved ? <><Check className="w-4 h-4" />Saved</> : 'Save changes'}
          </button>
        </div>
      )}

      {/* Notifications tab */}
      {activeTab === 'notifications' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">Alert preferences</h2>
            <div className="space-y-4">
              {[
                { label: 'High priority alerts', desc: 'Sent immediately when a high-risk event is detected', defaultOn: true },
                { label: 'Medium priority alerts', desc: 'Batched and sent every hour', defaultOn: true },
                { label: 'Daily summary report', desc: 'End-of-day summary of all incidents and cash status', defaultOn: true },
                { label: 'Follow-up reminders', desc: 'Reminders for unresolved high-priority incidents', defaultOn: true },
              ].map(({ label, desc, defaultOn }) => (
                <div key={label} className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                    <input type="checkbox" defaultChecked={defaultOn} className="sr-only peer" />
                    <div className="w-10 h-5 bg-slate-200 peer-checked:bg-brand-600 rounded-full peer-focus:ring-2 peer-focus:ring-brand-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">Notification channels</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Alert email address</label>
                <input type="email" placeholder="alerts@yourstore.com" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">WhatsApp number (optional)</label>
                <input type="tel" placeholder="+92 300 0000000" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                <p className="text-xs text-slate-400 mt-1">WhatsApp Business API required. Contact support to configure.</p>
              </div>
            </div>
            <button onClick={handleSave} className="mt-4 flex items-center gap-2 bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors">
              {saved ? <><Check className="w-4 h-4" />Saved</> : 'Save preferences'}
            </button>
          </div>
        </div>
      )}

      {/* Rules tab */}
      {activeTab === 'rules' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-slate-900">Detection rules</h2>
            <span className="text-xs text-slate-500">{Object.values(rules).filter(Boolean).length}/{RULE_LIST.length} active</span>
          </div>
          <p className="text-xs text-slate-500 mb-5">Enable or disable individual detection rules. Changes are audited.</p>

          <div className="space-y-1">
            {RULE_LIST.map(rule => (
              <div key={rule.id} className="flex items-start gap-4 p-3 rounded-lg hover:bg-slate-50 transition-colors">
                <label className="relative inline-flex items-center cursor-pointer flex-shrink-0 mt-0.5">
                  <input type="checkbox" checked={rules[rule.id] ?? false} onChange={() => toggleRule(rule.id)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-slate-200 peer-checked:bg-brand-600 rounded-full peer-focus:ring-2 peer-focus:ring-brand-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                </label>
                <div>
                  <p className="text-sm font-medium text-slate-900">{rule.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{rule.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <button onClick={handleSave} className="mt-5 flex items-center gap-2 bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors">
            {saved ? <><Check className="w-4 h-4" />Saved</> : 'Save rule configuration'}
          </button>
        </div>
      )}

      {/* Team tab */}
      {activeTab === 'team' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-slate-900">Team members</h2>
            <button className="text-sm text-brand-600 font-medium hover:text-brand-700">+ Invite member</button>
          </div>
          <div className="space-y-3">
            {[
              { name: 'You', email: 'owner@store.com', role: 'OWNER' },
            ].map(member => (
              <div key={member.email} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white text-xs font-bold">
                    {member.name[0]}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{member.name}</p>
                    <p className="text-xs text-slate-500">{member.email}</p>
                  </div>
                </div>
                <span className="text-xs font-medium text-brand-700 bg-brand-50 px-2 py-0.5 rounded border border-brand-200">
                  {member.role}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-4">Roles: Owner → Admin → Manager → Investigator → Viewer. Each role has specific permissions.</p>
        </div>
      )}
    </div>
  )
}
