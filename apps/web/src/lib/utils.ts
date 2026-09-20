import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { nanoid } from 'nanoid'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateId(): string {
  return nanoid(21)
}

/**
 * Format a monetary amount.
 * @deprecated Use formatCurrency from '@/lib/money' with explicit locale/currency from org settings.
 * This wrapper exists for backward compatibility only.
 */
export function formatCurrency(amount: number, currency = 'USD', locale = 'en-US'): string {
  try {
    const { formatCurrency: fmt } = require('./money')
    return fmt(amount, currency, locale)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

/**
 * Format a date.
 * @deprecated Use formatDate from '@/lib/money' with org locale/timezone.
 */
export function formatDate(date: Date | string): string {
  try {
    const { formatDate: fmt } = require('./money')
    return fmt(date, 'en-US')
  } catch {
    return new Date(date).toLocaleDateString()
  }
}

/**
 * Format a date+time.
 * @deprecated Use formatDateTime from '@/lib/money' with org locale/timezone.
 */
export function formatDateTime(date: Date | string): string {
  try {
    const { formatDateTime: fmt } = require('./money')
    return fmt(date, 'en-US')
  } catch {
    return new Date(date).toLocaleString()
  }
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function timeAgo(date: Date | string): string {
  const now = new Date()
  const d = new Date(date)
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000)

  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function getRiskColor(level: string): string {
  switch (level) {
    case 'HIGH': return 'text-red-700 bg-red-50 border-red-200'
    case 'MEDIUM': return 'text-amber-700 bg-amber-50 border-amber-200'
    case 'LOW': return 'text-green-700 bg-green-50 border-green-200'
    default: return 'text-slate-700 bg-slate-50 border-slate-200'
  }
}

export function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'CRITICAL': return 'text-red-800 bg-red-100'
    case 'HIGH': return 'text-red-700 bg-red-50'
    case 'MEDIUM': return 'text-amber-700 bg-amber-50'
    case 'LOW': return 'text-green-700 bg-green-50'
    default: return 'text-slate-600 bg-slate-100'
  }
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'OPEN': return 'text-blue-700 bg-blue-50'
    case 'UNDER_REVIEW': return 'text-amber-700 bg-amber-50'
    case 'RESOLVED': return 'text-green-700 bg-green-50'
    case 'DISMISSED': return 'text-slate-600 bg-slate-100'
    default: return 'text-slate-600 bg-slate-100'
  }
}
