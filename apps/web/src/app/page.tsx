import Link from 'next/link'
import { ShieldCheck, AlertCircle, TrendingUp, Users, BarChart3, Bell, FileSearch, ChevronRight, Clock, CreditCard, CheckCircle } from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="border-b border-slate-100 bg-white/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-brand-600" />
            <span className="text-lg font-semibold text-slate-900">ShopGuard</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="#features" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">Features</Link>
            <Link href="#how-it-works" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">How it works</Link>
            <Link href="/login" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">Sign in</Link>
            <Link href="/signup" className="inline-flex items-center gap-1.5 bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors">
              Start Free Trial
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-24">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 bg-brand-50 text-brand-700 text-xs font-medium px-3 py-1.5 rounded-full mb-6 border border-brand-100">
            <ShieldCheck className="w-3.5 h-3.5" />
            Retail Transaction Intelligence
          </div>
          <h1 className="text-5xl font-bold text-slate-900 leading-tight mb-6">
            Know which transactions deserve a second look.
          </h1>
          <p className="text-xl text-slate-600 leading-relaxed mb-8 max-w-2xl">
            ShopGuard monitors your POS activity, cash behavior, and employee patterns to surface unusual events before they become expensive problems.
          </p>
          <p className="text-base text-slate-500 mb-10 max-w-xl">
            Keep your existing POS and cameras. ShopGuard connects to your transaction data — no hardware changes required.
          </p>
          <div className="flex items-center gap-4">
            <Link href="/signup" className="inline-flex items-center gap-2 bg-brand-600 text-white font-semibold px-6 py-3 rounded-xl hover:bg-brand-700 transition-colors shadow-sm text-sm">
              Start Monitoring
              <ChevronRight className="w-4 h-4" />
            </Link>
            <Link href="/login?demo=1" className="inline-flex items-center gap-2 text-slate-700 font-medium px-6 py-3 rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors text-sm">
              <FileSearch className="w-4 h-4" />
              View Demo
            </Link>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="bg-slate-900 text-white py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-2xl mb-14">
            <h2 className="text-3xl font-bold mb-4">Most retail losses are small, repeated, and invisible.</h2>
            <p className="text-slate-400 text-lg leading-relaxed">
              You cannot watch every register, every shift, every employee at once. Patterns that should be obvious go unnoticed for months.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: AlertCircle, title: 'Voided after cash payments', desc: 'Sale recorded, drawer opened, transaction cancelled. The pattern repeats.' },
              { icon: TrendingUp, title: 'Gradual discount abuse', desc: "An employee's discount rate creeps up slowly enough to avoid notice." },
              { icon: Clock, title: 'After-hours activity', desc: 'Transactions that occur when no one is supposed to be there.' },
            ].map((item) => (
              <div key={item.title} className="bg-slate-800 rounded-xl p-6">
                <item.icon className="w-8 h-8 text-brand-400 mb-4" />
                <h3 className="font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">How ShopGuard works</h2>
            <p className="text-slate-600 max-w-xl mx-auto">From CSV upload to your first insight in minutes. No training required.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {[
              { step: '01', title: 'Import your POS data', desc: 'Upload a CSV export from any POS system. ShopGuard automatically detects columns.' },
              { step: '02', title: 'Baselines are calculated', desc: 'The system learns normal behavior for each employee, register, store, and time of day.' },
              { step: '03', title: 'Unusual events surface', desc: 'Rules, statistical analysis, and machine learning flag events worth reviewing.' },
              { step: '04', title: 'You review and decide', desc: 'Every alert explains why it was flagged. You make the final call — always.' },
            ].map((item) => (
              <div key={item.step} className="relative">
                <div className="text-4xl font-bold text-slate-100 mb-3">{item.step}</div>
                <h3 className="font-semibold text-slate-900 mb-2">{item.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 bg-slate-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">What ShopGuard monitors</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: AlertCircle, title: 'Transaction Anomalies', items: ['Voids after cash payments', 'Rapid sale-refund sequences', 'Price overrides', 'Excessive discounts'] },
              { icon: CreditCard, title: 'Cash Monitoring', items: ['Opening vs closing cash', 'Expected vs counted cash', 'Shift-level variance', 'Register-level variance'] },
              { icon: Users, title: 'Employee Analytics', items: ['Per-employee void rates', 'Discount patterns', 'Transaction volume baselines', 'Behavioral changes over time'] },
              { icon: BarChart3, title: 'Store Intelligence', items: ['Store baseline comparisons', 'Register-level anomalies', 'Time-of-day patterns', 'Day-of-week baselines'] },
              { icon: Bell, title: 'Automated Alerts', items: ['Immediate high-priority alerts', 'Daily summary reports', 'Follow-up reminders', 'Email and WhatsApp support'] },
              { icon: FileSearch, title: 'Investigation Tools', items: ['Evidence-based incident pages', 'Timeline view', 'Related incident linking', 'Review and feedback tracking'] },
            ].map((feature) => (
              <div key={feature.title} className="bg-white rounded-xl p-6 border border-slate-200">
                <feature.icon className="w-6 h-6 text-brand-600 mb-4" />
                <h3 className="font-semibold text-slate-900 mb-3">{feature.title}</h3>
                <ul className="space-y-1.5">
                  {feature.items.map(item => (
                    <li key={item} className="flex items-center gap-2 text-sm text-slate-600">
                      <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Important principle */}
      <section className="py-20 bg-brand-950 text-white">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <ShieldCheck className="w-12 h-12 text-brand-400 mx-auto mb-6" />
          <h2 className="text-3xl font-bold mb-6">ShopGuard flags events. You decide what they mean.</h2>
          <p className="text-brand-200 text-lg leading-relaxed mb-4">
            ShopGuard uses neutral language for every alert. We surface unusual patterns and explain why they were flagged.
          </p>
          <p className="text-brand-300 leading-relaxed">
            We never tell you an employee committed fraud. We never show fraud probabilities. Every flagged event shows its evidence, and you make the final decision after your own investigation.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 bg-white">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-slate-900 mb-10 text-center">Common questions</h2>
          <div className="space-y-6">
            {[
              { q: 'Does ShopGuard require new hardware?', a: 'No. ShopGuard works with CSV exports from your existing POS system. You can also connect via API when ready.' },
              { q: 'What POS systems does ShopGuard support?', a: 'Any POS that can export transactions to CSV. ShopGuard automatically detects column formats. Direct integrations are being added.' },
              { q: 'How does ShopGuard avoid false alarms?', a: 'ShopGuard builds individual baselines for each employee, store, and register. It considers time of day, day of week, and transaction volume before flagging unusual activity.' },
              { q: 'What currencies are supported?', a: 'ShopGuard supports all major currencies including USD, EUR, GBP, AED, SAR, PKR, INR, JPY, and 40+ others. Your organization currency is configured in Settings.' },
              { q: "Is employee data kept confidential?", a: 'Transaction data is stored securely and is only accessible to authorized users in your organization. ShopGuard does not share data between tenants.' },
            ].map((faq) => (
              <div key={faq.q} className="border-b border-slate-100 pb-6">
                <h3 className="font-semibold text-slate-900 mb-2">{faq.q}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-brand-600">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Start monitoring your transactions today</h2>
          <p className="text-brand-200 mb-8">Import your first CSV in minutes. See what ShopGuard surfaces in your historical data.</p>
          <Link href="/signup" className="inline-flex items-center gap-2 bg-white text-brand-700 font-semibold px-8 py-3.5 rounded-xl hover:bg-brand-50 transition-colors shadow-sm">
            Get Started Free
            <ChevronRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-12">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-brand-400" />
            <span className="text-white font-medium">ShopGuard</span>
          </div>
          <p className="text-sm">Retail transaction intelligence for businesses worldwide.</p>
        </div>
      </footer>
    </div>
  )
}
