'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ShieldCheck, LayoutDashboard, AlertTriangle, Store, Users,
  CreditCard, Upload, FileText, Settings, Activity, Brain
} from 'lucide-react'
import { cn } from '@/lib/utils'

const nav = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/incidents', icon: AlertTriangle, label: 'Incidents' },
  { href: '/cash', icon: CreditCard, label: 'Cash' },
  { href: '/employees', icon: Users, label: 'Employees' },
  { href: '/stores', icon: Store, label: 'Stores' },
  { href: '/reports', icon: FileText, label: 'Reports' },
  { href: '/import', icon: Upload, label: 'Import Data' },
  { href: '/settings', icon: Settings, label: 'Settings' },
  { href: '/admin/ml', icon: Brain, label: 'ML Admin' },
  { href: '/admin/system-health', icon: Activity, label: 'System Health' },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-56 bg-slate-900 flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="h-16 flex items-center gap-2.5 px-5 border-b border-slate-800">
        <ShieldCheck className="w-6 h-6 text-brand-400" />
        <span className="text-white font-semibold text-base tracking-tight">ShopGuard</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
        {nav.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                active
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* System status indicator */}
      <div className="p-4 border-t border-slate-800">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Activity className="w-3.5 h-3.5" />
          <span>System operational</span>
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 ml-auto" />
        </div>
      </div>
    </aside>
  )
}
