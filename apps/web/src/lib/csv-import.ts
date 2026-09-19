// ShopGuard CSV Import Engine

import { parse } from 'csv-parse/sync'
import type { CSVInspectResult, CsvColumnMapping } from '@shopguard/types'

// Normalized field definitions
export const NORMALIZED_FIELDS = {
  externalTransactionId: {
    required: true,
    aliases: ['transaction id', 'txn id', 'receipt id', 'order id', 'invoice id', 'transaction_id', 'txn_id', 'receipt_no', 'ref'],
  },
  timestamp: {
    required: true,
    aliases: ['date', 'transaction date', 'txn date', 'created at', 'datetime', 'time', 'date_time', 'transaction_date', 'sale_date', 'created_at'],
  },
  grossAmount: {
    required: true,
    aliases: ['amount', 'total', 'gross total', 'sale amount', 'gross_amount', 'total_amount', 'price', 'gross', 'subtotal', 'amount_gross'],
  },
  netAmount: {
    required: false,
    aliases: ['net amount', 'net total', 'net_amount', 'net_total', 'final_amount', 'after_discount'],
  },
  employeeId: {
    required: false,
    aliases: ['employee', 'employee name', 'staff', 'staff name', 'cashier', 'operator', 'clerk', 'user', 'employee_id', 'staff_id', 'cashier_id', 'cashier_name'],
  },
  storeId: {
    required: false,
    aliases: ['store', 'branch', 'location', 'outlet', 'store_id', 'branch_id', 'store_name', 'branch_name'],
  },
  registerId: {
    required: false,
    aliases: ['register', 'terminal', 'till', 'pos', 'counter', 'register_id', 'terminal_id', 'till_id', 'register_name'],
  },
  paymentMethod: {
    required: false,
    aliases: ['payment method', 'pay type', 'tender', 'payment type', 'payment', 'payment_method', 'pay_type', 'tender_type', 'mode_of_payment'],
  },
  discountAmount: {
    required: false,
    aliases: ['discount', 'discount amount', 'disc', 'discount_amount', 'disc_amount'],
  },
  discountPercent: {
    required: false,
    aliases: ['discount %', 'discount percent', 'disc %', 'disc_percent', 'discount_pct', 'disc_pct'],
  },
  refundAmount: {
    required: false,
    aliases: ['refund', 'refund amount', 'return', 'return amount', 'refund_amount', 'return_amount'],
  },
  isVoid: {
    required: false,
    aliases: ['void', 'voided', 'is_void', 'cancelled', 'void_flag'],
  },
  isRefund: {
    required: false,
    aliases: ['refund', 'is_refund', 'is_return', 'refund_flag', 'return_flag'],
  },
  isNoSale: {
    required: false,
    aliases: ['no sale', 'no_sale', 'drawer_open', 'nosale'],
  },
  itemCount: {
    required: false,
    aliases: ['items', 'item count', 'qty', 'quantity', 'line_items', 'item_count', 'num_items'],
  },
  transactionStatus: {
    required: false,
    aliases: ['status', 'transaction status', 'txn_status', 'state'],
  },
  currency: {
    required: false,
    aliases: ['currency', 'currency_code', 'curr'],
  },
  notes: {
    required: false,
    aliases: ['notes', 'note', 'comments', 'remark', 'description'],
  },
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function detectColumnMappings(headers: string[]): CsvColumnMapping[] {
  const mappings: CsvColumnMapping[] = []
  
  for (const [normalizedField, def] of Object.entries(NORMALIZED_FIELDS)) {
    for (const header of headers) {
      const normalized = normalizeHeader(header)
      const match = def.aliases.find(alias => normalized === alias || normalized.includes(alias) || alias.includes(normalized))
      
      if (match) {
        const confidence = normalized === match ? 1.0 : 0.7
        mappings.push({
          csvColumn: header,
          normalizedField,
          confidence,
        })
        break
      }
    }
  }
  
  return mappings
}

export async function inspectCSV(content: string): Promise<CSVInspectResult> {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[]
  
  if (records.length === 0) {
    return {
      headers: [],
      sampleRows: [],
      detectedMappings: [],
      ambiguousFields: [],
      missingRequired: Object.keys(NORMALIZED_FIELDS).filter(f => NORMALIZED_FIELDS[f as keyof typeof NORMALIZED_FIELDS].required),
      totalRows: 0,
    }
  }
  
  const headers = Object.keys(records[0])
  const sampleRows = records.slice(0, 5)
  const detectedMappings = detectColumnMappings(headers)
  
  const mappedFields = detectedMappings.map(m => m.normalizedField)
  const missingRequired = Object.entries(NORMALIZED_FIELDS)
    .filter(([field, def]) => def.required && !mappedFields.includes(field))
    .map(([field]) => field)
  
  const ambiguousFields = detectedMappings
    .filter(m => m.confidence < 0.9)
    .map(m => m.normalizedField)
  
  return {
    headers,
    sampleRows,
    detectedMappings,
    ambiguousFields,
    missingRequired,
    totalRows: records.length,
  }
}

export function parseTimestamp(value: string): Date | null {
  // Try multiple formats
  const formats = [
    // ISO formats
    (v: string) => new Date(v),
    // DD/MM/YYYY
    (v: string) => {
      const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/)
      if (m) return new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}${m[4]}`)
      return null
    },
    // MM-DD-YYYY
    (v: string) => {
      const m = v.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(.*)$/)
      if (m) return new Date(`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}${m[4]}`)
      return null
    },
  ]
  
  for (const fmt of formats) {
    try {
      const d = fmt(value)
      if (d && !isNaN(d.getTime())) return d
    } catch {}
  }
  return null
}

export function parseAmount(value: string): number | null {
  if (!value || value.trim() === '') return null
  // Strip currency symbols and letter prefixes (Rs., PKR, USD, $, etc.)
  // then remove commas used as thousands separators
  const cleaned = value
    .replace(/[A-Za-z]+\.?\s*/g, '') // strip "Rs.", "PKR", "USD", etc.
    .replace(/,/g, '')                  // remove thousands commas
    .replace(/[^0-9.-]/g, '')           // remove remaining non-numeric
    .trim()
  if (!cleaned) return null
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

export function parseBoolean(value: string): boolean {
  if (!value) return false
  const v = value.toLowerCase().trim()
  return ['true', '1', 'yes', 'y', 'voided', 'void', 'refund', 'returned'].includes(v)
}

export function parsePaymentMethod(value: string): string {
  if (!value) return 'unknown'
  const v = value.toLowerCase().trim()
  if (['cash', 'cash payment', 'currency'].includes(v)) return 'cash'
  if (['card', 'credit', 'debit', 'credit card', 'debit card', 'visa', 'mastercard'].some(k => v.includes(k))) return 'card'
  if (['mobile', 'jazzcash', 'easypaisa', 'mobile money', 'wallet'].some(k => v.includes(k))) return 'mobile'
  return v || 'other'
}
