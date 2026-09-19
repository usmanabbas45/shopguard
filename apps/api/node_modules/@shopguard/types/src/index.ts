// ShopGuard Shared Types

export type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'INVESTIGATOR' | 'VIEWER'
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'
export type IncidentStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'DISMISSED'
export type ReviewLabel = 'VALID_INCIDENT' | 'FALSE_POSITIVE' | 'NEEDS_INVESTIGATION' | 'NOT_ENOUGH_EVIDENCE'
export type TxStatus = 'COMPLETED' | 'VOIDED' | 'REFUNDED' | 'PARTIAL_REFUND' | 'PENDING' | 'CANCELLED'
export type ImportStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
export type NotifChannel = 'EMAIL' | 'WHATSAPP' | 'SMS' | 'IN_APP'
export type BaselineConf = 'LOW' | 'MEDIUM' | 'HIGH'

export interface Organization {
  id: string
  name: string
  slug: string
  timezone: string
  currency: string
  locale: string
  businessType?: string
  isDemo: boolean
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface User {
  id: string
  email: string
  name: string
  phone?: string
  emailVerified: boolean
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Membership {
  id: string
  organizationId: string
  userId: string
  role: Role
  isActive: boolean
}

export interface Store {
  id: string
  organizationId: string
  name: string
  code?: string
  address?: string
  timezone?: string
  isActive: boolean
  openingHour: number
  closingHour: number
  createdAt: Date
}

export interface Register {
  id: string
  organizationId: string
  storeId: string
  name: string
  code?: string
  isActive: boolean
}

export interface Employee {
  id: string
  organizationId: string
  externalId?: string
  name: string
  code?: string
  email?: string
  role?: string
  isActive: boolean
  createdAt: Date
}

export interface Transaction {
  id: string
  organizationId: string
  storeId: string
  registerId?: string
  employeeId?: string
  externalTransactionId?: string
  timestamp: Date
  currency: string
  grossAmount: number
  discountAmount: number
  refundAmount: number
  netAmount: number
  paymentMethod?: string
  transactionStatus: TxStatus
  itemCount?: number
  durationSeconds?: number
  isVoid: boolean
  isRefund: boolean
  isNoSale: boolean
  hasPriceOverride: boolean
  discountPercent?: number
  source: string
  isDemo: boolean
}

export interface Incident {
  id: string
  organizationId: string
  storeId?: string
  registerId?: string
  employeeId?: string
  severity: Severity
  riskLevel: RiskLevel
  status: IncidentStatus
  type: string
  title: string
  summary: string
  whyFlagged: string[]
  ruleIds: string[]
  modelVersion?: string
  mlScore?: number
  nextFollowUpAt?: Date
  followUpCount: number
  escalationLevel: number
  isDemo: boolean
  createdAt: Date
  updatedAt: Date
  // populated relations
  store?: Store
  employee?: Employee
  register?: Register
  evidence?: IncidentEvidence[]
  reviews?: IncidentReview[]
}

export interface IncidentEvidence {
  id: string
  incidentId: string
  ruleId?: string
  type: string
  description: string
  severity: Severity
  score: number
  metadata?: Record<string, unknown>
}

export interface IncidentReview {
  id: string
  incidentId: string
  userId: string
  label: ReviewLabel
  notes?: string
  createdAt: Date
}

export interface RuleResult {
  ruleId: string
  triggered: boolean
  severity: Severity
  evidence: string
  scoreContribution: number
  metadata?: Record<string, unknown>
}

export interface RiskScore {
  ruleScore: number
  baselineScore: number
  mlScore: number
  totalScore: number
  riskLevel: RiskLevel
  triggeredRules: RuleResult[]
  evidenceItems: string[]
}

export interface NormalizedTransaction extends Transaction {
  features?: TransactionFeatures
}

export interface TransactionFeatures {
  amount: number
  logAmount: number
  itemCount: number
  discountPercent: number
  refundAmount: number
  hour: number
  dayOfWeek: number
  paymentMethodCode: number
  afterHours: boolean
  isVoid: boolean
  isRefund: boolean
  hasPriceOverride: boolean
  // Employee context
  employeeTxPerHour?: number
  employeeVoidRate?: number
  employeeRefundRate?: number
  employeeDiscountRate?: number
  // Deviations
  amountDeviationFromEmployeeBaseline?: number
  amountDeviationFromStoreBaseline?: number
  employeeVoidRateDeviation?: number
}

export interface EmployeeBaseline {
  employeeId: string
  period: string
  confidence: BaselineConf
  txCount: number
  avgAmount?: number
  medianAmount?: number
  stdAmount?: number
  txPerHour?: number
  voidRate?: number
  refundRate?: number
  discountRate?: number
  priceOverrideRate?: number
  avgDiscountPct?: number
}

export interface StoreBaseline {
  storeId: string
  period: string
  confidence: BaselineConf
  txCount: number
  avgAmount?: number
  medianAmount?: number
  stdAmount?: number
  voidRate?: number
  refundRate?: number
  discountRate?: number
  hourlyVolume?: Record<string, number>
  dowVolume?: Record<string, number>
}

export interface ImportQualityReport {
  totalRows: number
  importedRows: number
  skippedRows: number
  errorRows: number
  missingFields: string[]
  duplicates: number
  invalidTimestamps: number
  negativeAmounts: number
  issues: QualityIssue[]
}

export interface QualityIssue {
  rowNumber?: number
  field?: string
  issueType: string
  description: string
  rawValue?: string
}

export interface DashboardStats {
  todaySales: number
  cashExpected: number
  cashCounted?: number
  cashVariance?: number
  highPriorityCount: number
  mediumPriorityCount: number
  reviewedToday: number
  unreviewedCount: number
  currency: string
}

export interface CsvColumnMapping {
  csvColumn: string
  normalizedField: string
  confidence: number
  sample?: string[]
}

export interface CSVInspectResult {
  headers: string[]
  sampleRows: Record<string, string>[]
  detectedMappings: CsvColumnMapping[]
  ambiguousFields: string[]
  missingRequired: string[]
  totalRows: number
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasNext: boolean
}

export interface SessionUser {
  id: string
  email: string
  name: string
  organizationId: string
  organizationName: string
  organizationSlug: string
  role: Role
  isDemo: boolean
}
