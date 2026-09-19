import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'ShopGuard — Retail Transaction Intelligence',
    template: '%s | ShopGuard',
  },
  description: 'Monitor POS activity, cash behavior, and employee patterns to surface unusual events before they become expensive problems.',
  keywords: ['retail fraud detection', 'POS monitoring', 'cash reconciliation', 'loss prevention', 'employee analytics'],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body className="min-h-screen bg-slate-50 antialiased">{children}</body>
    </html>
  )
}
