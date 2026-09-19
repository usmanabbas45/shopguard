import { describe, it, expect } from 'vitest'
import {
  detectColumnMappings,
  parseTimestamp,
  parseAmount,
  parseBoolean,
  parsePaymentMethod,
  inspectCSV,
} from '../lib/csv-import'

// ==================== COLUMN DETECTION TESTS ====================

describe('detectColumnMappings', () => {
  it('detects transaction ID column', () => {
    const headers = ['Transaction ID', 'Amount', 'Date']
    const mappings = detectColumnMappings(headers)
    const txIdMapping = mappings.find(m => m.normalizedField === 'externalTransactionId')
    expect(txIdMapping).toBeDefined()
    expect(txIdMapping?.csvColumn).toBe('Transaction ID')
  })

  it('detects amount with alias "Total"', () => {
    const headers = ['Receipt No', 'Total', 'Cashier']
    const mappings = detectColumnMappings(headers)
    const amtMapping = mappings.find(m => m.normalizedField === 'grossAmount')
    expect(amtMapping).toBeDefined()
  })

  it('detects employee column with alias "Staff Name"', () => {
    const headers = ['Staff Name', 'Sale Amount', 'Date']
    const mappings = detectColumnMappings(headers)
    const empMapping = mappings.find(m => m.normalizedField === 'employeeId')
    expect(empMapping).toBeDefined()
  })

  it('detects date column with alias "Transaction Date"', () => {
    const headers = ['Transaction Date', 'Net Total', 'Branch']
    const mappings = detectColumnMappings(headers)
    const dateMapping = mappings.find(m => m.normalizedField === 'timestamp')
    expect(dateMapping).toBeDefined()
  })

  it('detects register with alias "Till"', () => {
    const headers = ['Till', 'Amount', 'Date']
    const mappings = detectColumnMappings(headers)
    const regMapping = mappings.find(m => m.normalizedField === 'registerId')
    expect(regMapping).toBeDefined()
  })

  it('detects payment method with alias "Tender"', () => {
    const headers = ['Tender', 'Amount', 'Date']
    const mappings = detectColumnMappings(headers)
    const pmMapping = mappings.find(m => m.normalizedField === 'paymentMethod')
    expect(pmMapping).toBeDefined()
  })

  it('handles unknown headers gracefully', () => {
    const headers = ['Column1', 'Column2', 'Column3']
    const mappings = detectColumnMappings(headers)
    expect(mappings).toHaveLength(0)
  })

  it('detects store column with alias "Branch"', () => {
    const headers = ['Branch', 'Txn ID', 'Amount']
    const mappings = detectColumnMappings(headers)
    const storeMapping = mappings.find(m => m.normalizedField === 'storeId')
    expect(storeMapping).toBeDefined()
  })

  it('detects void flag', () => {
    const headers = ['Voided', 'Amount', 'Date']
    const mappings = detectColumnMappings(headers)
    const voidMapping = mappings.find(m => m.normalizedField === 'isVoid')
    expect(voidMapping).toBeDefined()
  })
})

// ==================== TIMESTAMP PARSING TESTS ====================

describe('parseTimestamp', () => {
  it('parses ISO 8601 dates', () => {
    const d = parseTimestamp('2025-01-15T14:30:00')
    expect(d).not.toBeNull()
    expect(d?.getFullYear()).toBe(2025)
    expect(d?.getMonth()).toBe(0) // January = 0
    expect(d?.getDate()).toBe(15)
  })

  it('parses DD/MM/YYYY format', () => {
    const d = parseTimestamp('15/01/2025')
    expect(d).not.toBeNull()
    expect(d?.getFullYear()).toBe(2025)
    expect(d?.getDate()).toBe(15)
  })

  it('parses MM-DD-YYYY format', () => {
    const d = parseTimestamp('01-15-2025')
    expect(d).not.toBeNull()
    expect(d?.getFullYear()).toBe(2025)
  })

  it('returns null for invalid dates', () => {
    expect(parseTimestamp('not-a-date')).toBeNull()
    expect(parseTimestamp('')).toBeNull()
    expect(parseTimestamp('99/99/9999')).toBeNull()
  })

  it('parses dates with time component', () => {
    const d = parseTimestamp('2025-06-15 09:30:00')
    expect(d).not.toBeNull()
  })
})

// ==================== AMOUNT PARSING TESTS ====================

describe('parseAmount', () => {
  it('parses plain numbers', () => {
    expect(parseAmount('1500')).toBe(1500)
    expect(parseAmount('1500.50')).toBeCloseTo(1500.50)
  })

  it('strips currency symbols', () => {
    expect(parseAmount('Rs. 1,500')).toBe(1500)
    expect(parseAmount('PKR 2000')).toBe(2000)
    expect(parseAmount('$15.99')).toBeCloseTo(15.99)
  })

  it('strips commas', () => {
    expect(parseAmount('1,500,000')).toBe(1500000)
  })

  it('returns null for empty/invalid', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('   ')).toBeNull()
  })

  it('handles negative amounts', () => {
    expect(parseAmount('-500')).toBe(-500)
  })
})

// ==================== BOOLEAN PARSING TESTS ====================

describe('parseBoolean', () => {
  it('parses truthy values', () => {
    expect(parseBoolean('true')).toBe(true)
    expect(parseBoolean('TRUE')).toBe(true)
    expect(parseBoolean('1')).toBe(true)
    expect(parseBoolean('yes')).toBe(true)
    expect(parseBoolean('Y')).toBe(true)
    expect(parseBoolean('voided')).toBe(true)
    expect(parseBoolean('void')).toBe(true)
  })

  it('returns false for empty/negative', () => {
    expect(parseBoolean('')).toBe(false)
    expect(parseBoolean('false')).toBe(false)
    expect(parseBoolean('no')).toBe(false)
    expect(parseBoolean('0')).toBe(false)
  })
})

// ==================== PAYMENT METHOD PARSING ====================

describe('parsePaymentMethod', () => {
  it('normalizes cash variants', () => {
    expect(parsePaymentMethod('Cash')).toBe('cash')
    expect(parsePaymentMethod('CASH PAYMENT')).toBe('cash')
    expect(parsePaymentMethod('currency')).toBe('cash')
  })

  it('normalizes card variants', () => {
    expect(parsePaymentMethod('Credit Card')).toBe('card')
    expect(parsePaymentMethod('Debit')).toBe('card')
    expect(parsePaymentMethod('Visa')).toBe('card')
    expect(parsePaymentMethod('Mastercard')).toBe('card')
  })

  it('normalizes mobile payment variants', () => {
    expect(parsePaymentMethod('JazzCash')).toBe('mobile')
    expect(parsePaymentMethod('Easypaisa')).toBe('mobile')
    expect(parsePaymentMethod('Mobile')).toBe('mobile')
  })

  it('handles unknown methods', () => {
    expect(parsePaymentMethod('')).toBe('unknown')
    expect(parsePaymentMethod('check')).toBe('check') // preserved as-is
  })
})

// ==================== CSV INSPECTION TESTS ====================

describe('inspectCSV', () => {
  it('detects headers and sample rows', async () => {
    const csv = `Transaction ID,Date,Amount,Cashier
TX001,2025-01-15,1500,Ahmed Khan
TX002,2025-01-15,2300,Sara Ali
TX003,2025-01-15,800,Ahmed Khan`

    const result = await inspectCSV(csv)
    expect(result.headers).toContain('Transaction ID')
    expect(result.headers).toContain('Date')
    expect(result.headers).toContain('Amount')
    expect(result.totalRows).toBe(3)
    expect(result.sampleRows).toHaveLength(3)
  })

  it('auto-detects column mappings', async () => {
    const csv = `Transaction ID,Date,Total,Staff Name,Payment Method
TX001,2025-01-15,1500,Ahmed Khan,Cash`

    const result = await inspectCSV(csv)
    const mappedFields = result.detectedMappings.map(m => m.normalizedField)
    expect(mappedFields).toContain('externalTransactionId')
    expect(mappedFields).toContain('timestamp')
    expect(mappedFields).toContain('grossAmount')
    expect(mappedFields).toContain('employeeId')
  })

  it('identifies missing required fields', async () => {
    const csv = `Amount,Cashier
1500,Ahmed`

    const result = await inspectCSV(csv)
    expect(result.missingRequired).toContain('timestamp')
    expect(result.missingRequired).toContain('externalTransactionId')
  })

  it('handles empty CSV', async () => {
    const result = await inspectCSV('')
    expect(result.totalRows).toBe(0)
    expect(result.headers).toHaveLength(0)
  })

  it('provides confidence scores for mappings', async () => {
    const csv = `Transaction ID,Date,Amount\nTX1,2025-01-15,1000`
    const result = await inspectCSV(csv)
    for (const mapping of result.detectedMappings) {
      expect(mapping.confidence).toBeGreaterThan(0)
      expect(mapping.confidence).toBeLessThanOrEqual(1)
    }
  })
})
