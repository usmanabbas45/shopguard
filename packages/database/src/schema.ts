import { pgTable, text, varchar, boolean, integer, bigint, numeric, timestamp, date, json, pgEnum, uniqueIndex, index, primaryKey } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// Enums
export const roleEnum = pgEnum('role', ['OWNER', 'ADMIN', 'MANAGER', 'INVESTIGATOR', 'VIEWER'])
export const dataSourceEnum = pgEnum('data_source', ['DEMO', 'CSV', 'API', 'WEBHOOK', 'TEST', 'SHOPIFY'])
export const severityEnum = pgEnum('severity', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
export const riskLevelEnum = pgEnum('risk_level', ['LOW', 'MEDIUM', 'HIGH'])
export const incidentStatusEnum = pgEnum('incident_status', ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED'])
export const reviewLabelEnum = pgEnum('review_label', ['VALID_INCIDENT', 'FALSE_POSITIVE', 'NEEDS_INVESTIGATION', 'NOT_ENOUGH_EVIDENCE'])
export const txStatusEnum = pgEnum('tx_status', ['COMPLETED', 'VOIDED', 'REFUNDED', 'PARTIAL_REFUND', 'PENDING', 'CANCELLED'])
export const importStatusEnum = pgEnum('import_status', ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'])
export const notifChannelEnum = pgEnum('notif_channel', ['EMAIL', 'WHATSAPP', 'SMS', 'IN_APP'])
export const notifTypeEnum = pgEnum('notif_type', ['INCIDENT_CREATED', 'INCIDENT_FOLLOWUP', 'INCIDENT_ESCALATION', 'DAILY_REPORT', 'SYSTEM_ALERT'])
export const notifStatusEnum = pgEnum('notif_status', ['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED'])
export const modelStatusEnum = pgEnum('model_status', ['CANDIDATE', 'PRODUCTION', 'RETIRED', 'FAILED'])
export const baselineConfEnum = pgEnum('baseline_conf', ['LOW', 'MEDIUM', 'HIGH'])
export const subscriptionPlanEnum = pgEnum('subscription_plan', ['TRIAL', 'STARTER', 'GROWTH', 'MULTI_LOCATION', 'ENTERPRISE'])
export const subscriptionStatusEnum = pgEnum('subscription_status', ['ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELLED', 'EXPIRED'])

// Organizations
export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  timezone: varchar('timezone', { length: 50 }).notNull().default('UTC'),
  currency: varchar('currency', { length: 10 }).notNull().default('USD'),
  locale: varchar('locale', { length: 20 }).notNull().default('en-US'),
  businessType: text('business_type'),
  country: varchar('country', { length: 2 }),        // ISO 3166-1 alpha-2 e.g. US, GB, PK, AE
  countryCode: varchar('country_code', { length: 6 }), // Dialing code e.g. +1, +44, +92
  isDemo: boolean('is_demo').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const orgSettings = pgTable('org_settings', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().unique().references(() => organizations.id, { onDelete: 'cascade' }),
  riskThresholdHigh: numeric('risk_threshold_high', { precision: 4, scale: 2 }).notNull().default('0.70'),
  riskThresholdMedium: numeric('risk_threshold_medium', { precision: 4, scale: 2 }).notNull().default('0.40'),
  minSampleSizeEmployee: integer('min_sample_size_employee').notNull().default(20),
  minSampleSizeStore: integer('min_sample_size_store').notNull().default(100),
  followUpHighHours: integer('follow_up_high_hours').notNull().default(4),
  followUpMediumHours: integer('follow_up_medium_hours').notNull().default(24),
  followUpLowHours: integer('follow_up_low_hours').notNull().default(72),
  maxFollowUps: integer('max_follow_ups').notNull().default(3),
  dataRetentionDays: integer('data_retention_days').notNull().default(730),
  enableRules: boolean('enable_rules').notNull().default(true),
  enableML: boolean('enable_ml').notNull().default(true),
  enableNotifications: boolean('enable_notifications').notNull().default(true),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Users
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  emailVerified: boolean('email_verified').notNull().default(false),
  verifyToken: text('verify_token'),
  resetToken: text('reset_token'),
  resetTokenExpiry: timestamp('reset_token_expiry'),
  lastLoginAt: timestamp('last_login_at'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const memberships = pgTable('memberships', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull().default('VIEWER'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('memberships_org_user_idx').on(t.organizationId, t.userId),
}))

export const invitations = pgTable('invitations', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  role: roleEnum('role').notNull().default('VIEWER'),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Stores
export const stores = pgTable('stores', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  code: text('code'),
  address: text('address'),
  timezone: text('timezone'),
  isActive: boolean('is_active').notNull().default(true),
  openingHour: integer('opening_hour').notNull().default(8),
  closingHour: integer('closing_hour').notNull().default(22),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const registers = pgTable('registers', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  storeId: text('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  code: text('code'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Employees
export const employees = pgTable('employees', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  externalId: text('external_id'),
  name: text('name').notNull(),
  code: text('code'),
  email: text('email'),
  phone: text('phone'),
  role: text('role'),
  isActive: boolean('is_active').notNull().default(true),
  hiredAt: timestamp('hired_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Transactions
export const transactions = pgTable('transactions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  storeId: text('store_id').notNull().references(() => stores.id),
  registerId: text('register_id').references(() => registers.id),
  employeeId: text('employee_id').references(() => employees.id),
  externalTransactionId: text('external_transaction_id'),
  timestamp: timestamp('timestamp').notNull(),
  currency: varchar('currency', { length: 10 }).notNull().default('USD'),
  grossAmount: numeric('gross_amount', { precision: 18, scale: 2 }).notNull(),
  discountAmount: numeric('discount_amount', { precision: 18, scale: 2 }).notNull().default('0'),
  refundAmount: numeric('refund_amount', { precision: 18, scale: 2 }).notNull().default('0'),
  netAmount: numeric('net_amount', { precision: 18, scale: 2 }).notNull(),
  paymentMethod: text('payment_method'),
  paymentChannel: text('payment_channel'),       // IN_STORE, ONLINE, MOBILE_APP, etc.
  paymentProvider: text('payment_provider'),      // stripe, square, payfast, etc. (provider name only)
  paymentReference: text('payment_reference'),    // Provider payment/intent ID (safe reference, never PAN)
  paymentLast4: varchar('payment_last4', { length: 4 }),  // Last 4 digits if supplied by provider
  paymentBrand: varchar('payment_brand', { length: 50 }), // visa, mastercard, amex, etc.
  transactionStatus: txStatusEnum('transaction_status').notNull().default('COMPLETED'),
  itemCount: integer('item_count'),
  durationSeconds: integer('duration_seconds'),
  isVoid: boolean('is_void').notNull().default(false),
  isRefund: boolean('is_refund').notNull().default(false),
  isNoSale: boolean('is_no_sale').notNull().default(false),
  hasPriceOverride: boolean('has_price_override').notNull().default(false),
  discountPercent: numeric('discount_percent', { precision: 5, scale: 2 }),
  notes: text('notes'),
  metadata: json('metadata'),
  source: text('source').notNull().default('csv'),   // csv | webhook_square | api | etc.
  dataSource: dataSourceEnum('data_source').notNull().default('CSV'), // DEMO|CSV|API|WEBHOOK|TEST
  sourceRecordId: text('source_record_id'),
  importJobId: text('import_job_id'),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Cash Sessions
export const cashSessions = pgTable('cash_sessions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  storeId: text('store_id').notNull().references(() => stores.id),
  registerId: text('register_id').references(() => registers.id),
  employeeId: text('employee_id').references(() => employees.id),
  date: date('date').notNull(),
  shiftType: text('shift_type'),
  openingCash: numeric('opening_cash', { precision: 18, scale: 2 }).notNull(),
  cashSales: numeric('cash_sales', { precision: 18, scale: 2 }).notNull().default('0'),
  cashRefunds: numeric('cash_refunds', { precision: 18, scale: 2 }).notNull().default('0'),
  cashAdjustments: numeric('cash_adjustments', { precision: 18, scale: 2 }).notNull().default('0'),
  expectedCash: numeric('expected_cash', { precision: 18, scale: 2 }).notNull(),
  countedCash: numeric('counted_cash', { precision: 18, scale: 2 }),
  variance: numeric('variance', { precision: 18, scale: 2 }),
  isReconciled: boolean('is_reconciled').notNull().default(false),
  notes: text('notes'),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Incidents
export const incidents = pgTable('incidents', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  storeId: text('store_id').references(() => stores.id),
  registerId: text('register_id').references(() => registers.id),
  employeeId: text('employee_id').references(() => employees.id),
  severity: severityEnum('severity').notNull(),
  riskLevel: riskLevelEnum('risk_level').notNull(),
  status: incidentStatusEnum('status').notNull().default('OPEN'),
  type: text('type').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  whyFlagged: json('why_flagged').notNull().default([]),
  ruleIds: json('rule_ids').notNull().default([]),
  modelVersion: text('model_version'),
  featureVersion: text('feature_version'),
  mlScore: numeric('ml_score', { precision: 5, scale: 4 }),
  nextFollowUpAt: timestamp('next_follow_up_at'),
  followUpCount: integer('follow_up_count').notNull().default(0),
  escalationLevel: integer('escalation_level').notNull().default(0),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const incidentEvidence = pgTable('incident_evidence', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
  ruleId: text('rule_id'),
  type: text('type').notNull(),
  description: text('description').notNull(),
  severity: severityEnum('severity').notNull(),
  score: numeric('score', { precision: 5, scale: 4 }).notNull().default('0'),
  metadata: json('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const incidentTransactions = pgTable('incident_transactions', {
  incidentId: text('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
  transactionId: text('transaction_id').notNull().references(() => transactions.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.incidentId, t.transactionId] }),
}))

export const incidentReviews = pgTable('incident_reviews', {
  id: text('id').primaryKey(),
  incidentId: text('incident_id').notNull().references(() => incidents.id),
  userId: text('user_id').notNull().references(() => users.id),
  label: reviewLabelEnum('label').notNull(),
  notes: text('notes'),
  modelVersion: text('model_version'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Baselines
export const employeeBaselines = pgTable('employee_baselines', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  employeeId: text('employee_id').notNull().references(() => employees.id),
  period: text('period').notNull(),
  confidence: baselineConfEnum('confidence').notNull(),
  txCount: integer('tx_count').notNull().default(0),
  avgAmount: numeric('avg_amount', { precision: 18, scale: 2 }),
  medianAmount: numeric('median_amount', { precision: 18, scale: 2 }),
  stdAmount: numeric('std_amount', { precision: 18, scale: 2 }),
  txPerHour: numeric('tx_per_hour', { precision: 8, scale: 4 }),
  voidRate: numeric('void_rate', { precision: 6, scale: 5 }),
  refundRate: numeric('refund_rate', { precision: 6, scale: 5 }),
  discountRate: numeric('discount_rate', { precision: 6, scale: 5 }),
  priceOverrideRate: numeric('price_override_rate', { precision: 6, scale: 5 }),
  avgDiscountPct: numeric('avg_discount_pct', { precision: 6, scale: 3 }),
  computedAt: timestamp('computed_at').notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('emp_baseline_period_idx').on(t.employeeId, t.period),
}))

export const storeBaselines = pgTable('store_baselines', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  storeId: text('store_id').notNull().references(() => stores.id),
  period: text('period').notNull(),
  confidence: baselineConfEnum('confidence').notNull(),
  txCount: integer('tx_count').notNull().default(0),
  avgAmount: numeric('avg_amount', { precision: 18, scale: 2 }),
  medianAmount: numeric('median_amount', { precision: 18, scale: 2 }),
  stdAmount: numeric('std_amount', { precision: 18, scale: 2 }),
  voidRate: numeric('void_rate', { precision: 6, scale: 5 }),
  refundRate: numeric('refund_rate', { precision: 6, scale: 5 }),
  discountRate: numeric('discount_rate', { precision: 6, scale: 5 }),
  hourlyVolume: json('hourly_volume'),
  dowVolume: json('dow_volume'),
  computedAt: timestamp('computed_at').notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('store_baseline_period_idx').on(t.storeId, t.period),
}))

// Import
export const importJobs = pgTable('import_jobs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  storeId: text('store_id').references(() => stores.id),
  filename: text('filename').notNull(),
  originalName: text('original_name').notNull(),
  fileSize: integer('file_size').notNull(),
  status: importStatusEnum('status').notNull().default('PENDING'),
  mappingId: text('mapping_id'),
  rowCount: integer('row_count'),
  importedCount: integer('imported_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  qualityReport: json('quality_report'),
  error: text('error'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const importMappings = pgTable('import_mappings', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  posType: text('pos_type'),
  columnMappings: json('column_mappings').notNull(),
  transformations: json('transformations'),
  isDefault: boolean('is_default').notNull().default(false),
  useCount: integer('use_count').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const dataQualityIssues = pgTable('data_quality_issues', {
  id: text('id').primaryKey(),
  importJobId: text('import_job_id').notNull().references(() => importJobs.id),
  rowNumber: integer('row_number'),
  field: text('field'),
  issueType: text('issue_type').notNull(),
  description: text('description').notNull(),
  rawValue: text('raw_value'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Notifications
export const notificationPreferences = pgTable('notification_preferences', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  channel: notifChannelEnum('channel').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  highPriority: boolean('high_priority').notNull().default(true),
  mediumPriority: boolean('medium_priority').notNull().default(true),
  lowPriority: boolean('low_priority').notNull().default(false),
  email: text('email'),
  phone: text('phone'),
  batchDelayMinutes: integer('batch_delay_minutes').notNull().default(60),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const notificationAttempts = pgTable('notification_attempts', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  incidentId: text('incident_id').references(() => incidents.id),
  channel: notifChannelEnum('channel').notNull(),
  type: notifTypeEnum('type').notNull(),
  recipient: text('recipient').notNull(),
  status: notifStatusEnum('status').notNull().default('PENDING'),
  providerMessageId: text('provider_message_id'),
  failureReason: text('failure_reason'),
  retryCount: integer('retry_count').notNull().default(0),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Reports
export const reports = pgTable('reports', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  storeId: text('store_id').references(() => stores.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  date: date('date').notNull(),
  summary: json('summary').notNull(),
  isGenerated: boolean('is_generated').notNull().default(false),
  isDemo: boolean('is_demo').notNull().default(false),
  generatedAt: timestamp('generated_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Audit Logs
export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').references(() => organizations.id),
  userId: text('user_id').references(() => users.id),
  action: text('action').notNull(),
  entity: text('entity'),
  entityId: text('entity_id'),
  metadata: json('metadata'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Rule Configs
export const ruleConfigs = pgTable('rule_configs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  ruleId: text('rule_id').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  severity: severityEnum('severity').notNull().default('MEDIUM'),
  thresholds: json('thresholds'),
  minSampleSize: integer('min_sample_size').notNull().default(10),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('rule_config_org_rule_idx').on(t.organizationId, t.ruleId),
}))

// Subscriptions
export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().unique().references(() => organizations.id),
  plan: subscriptionPlanEnum('plan').notNull().default('TRIAL'),
  status: subscriptionStatusEnum('status').notNull().default('ACTIVE'),
  trialEndsAt: timestamp('trial_ends_at'),
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  providerCustomerId: text('provider_customer_id'),
  providerSubscriptionId: text('provider_subscription_id'),
  currency: varchar('currency', { length: 10 }).default('USD'),
  billingCycle: text('billing_cycle').default('monthly'),
  provider: text('provider').default('stripe'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ==================== REGISTER BASELINES ====================

export const registerBaselines = pgTable('register_baselines', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  registerId: text('register_id').notNull().references(() => registers.id),
  period: text('period').notNull(), // rolling_7d, rolling_30d, rolling_60d
  confidence: baselineConfEnum('confidence').notNull(),
  txCount: integer('tx_count').notNull().default(0),
  noSaleRate: numeric('no_sale_rate', { precision: 6, scale: 5 }),
  voidRate: numeric('void_rate', { precision: 6, scale: 5 }),
  refundRate: numeric('refund_rate', { precision: 6, scale: 5 }),
  cashVarianceAvg: numeric('cash_variance_avg', { precision: 18, scale: 2 }),
  computedAt: timestamp('computed_at').notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('reg_baseline_period_idx').on(t.registerId, t.period),
}))

// ==================== HOURLY / DOW BASELINES ====================

export const timeBaselines = pgTable('time_baselines', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  storeId: text('store_id').notNull().references(() => stores.id),
  hour: integer('hour'), // 0-23, null means DOW-only
  dayOfWeek: integer('day_of_week'), // 0=Sun 6=Sat, null means hour-only
  avgVolume: numeric('avg_volume', { precision: 8, scale: 2 }),
  avgAmount: numeric('avg_amount', { precision: 18, scale: 2 }),
  avgVoidRate: numeric('avg_void_rate', { precision: 6, scale: 5 }),
  sampleWeeks: integer('sample_weeks').notNull().default(0),
  computedAt: timestamp('computed_at').notNull().defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('time_baseline_idx').on(t.storeId, t.hour, t.dayOfWeek),
}))

// ==================== FEATURE SNAPSHOTS ====================

export const featureSnapshots = pgTable('feature_snapshots', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id').notNull().unique().references(() => transactions.id),
  organizationId: text('organization_id').notNull(),
  features: json('features').notNull(),
  featureVersion: text('feature_version').notNull().default('1.0.0'),
  mlScore: numeric('ml_score', { precision: 6, scale: 5 }),
  mlModel: text('ml_model'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ==================== MODEL VERSIONING ====================

export const modelVersions = pgTable('model_versions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id'),
  name: text('name').notNull(),
  modelType: text('model_type').notNull(), // isolation_forest, hist_gradient_boosting
  version: text('version').notNull(),
  featureVersion: text('feature_version').notNull().default('1.0.0'),
  status: modelStatusEnum('status').notNull().default('CANDIDATE'),
  isProduction: boolean('is_production').notNull().default(false),
  trainingSampleCount: integer('training_sample_count'),
  trainingDatasetId: text('training_dataset_id'),
  metrics: json('metrics'),
  hyperparameters: json('hyperparameters'),
  artifactPath: text('artifact_path'),
  acceptanceCriteria: json('acceptance_criteria'),
  deployedAt: timestamp('deployed_at'),
  retiredAt: timestamp('retired_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const trainingDatasets = pgTable('training_datasets', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id'),
  name: text('name').notNull(),
  featureVersion: text('feature_version').notNull(),
  sampleCount: integer('sample_count').notNull().default(0),
  positiveLabelCount: integer('positive_label_count').notNull().default(0),
  negativeLabelCount: integer('negative_label_count').notNull().default(0),
  unlabeledCount: integer('unlabeled_count').notNull().default(0),
  isDemo: boolean('is_demo').notNull().default(false),
  fromDate: timestamp('from_date'),
  toDate: timestamp('to_date'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const trainingRuns = pgTable('training_runs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id'),
  datasetId: text('dataset_id').references(() => trainingDatasets.id),
  modelType: text('model_type').notNull(),
  status: text('status').notNull().default('PENDING'), // PENDING RUNNING COMPLETED FAILED
  triggeredBy: text('triggered_by').notNull(), // scheduled, manual, feedback_threshold, drift
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  durationSeconds: integer('duration_seconds'),
  candidateModelId: text('candidate_model_id'),
  productionModelId: text('production_model_id'),
  deployed: boolean('deployed').notNull().default(false),
  deploymentReason: text('deployment_reason'),
  rejectionReason: text('rejection_reason'),
  metrics: json('metrics'),
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ==================== INCIDENT RELATIONS (CORRELATION) ====================

export const incidentRelations = pgTable('incident_relations', {
  primaryIncidentId: text('primary_incident_id').notNull().references(() => incidents.id),
  relatedIncidentId: text('related_incident_id').notNull().references(() => incidents.id),
  relationType: text('relation_type').notNull(), // correlated, duplicate, sequence
}, (t) => ({
  pk: primaryKey({ columns: [t.primaryIncidentId, t.relatedIncidentId] }),
}))

// ==================== JOB LOGS ====================

export const jobLogs = pgTable('job_logs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id'),
  jobType: text('job_type').notNull(),
  jobId: text('job_id').notNull(),
  status: text('status').notNull(), // started, completed, failed, retrying
  attempt: integer('attempt').notNull().default(1),
  payload: json('payload'),
  result: json('result'),
  error: text('error'),
  durationMs: integer('duration_ms'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
})

// ==================== ANALYSIS JOBS ====================

export const analysisJobs = pgTable('analysis_jobs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  importJobId: text('import_job_id'),
  status: text('status').notNull().default('PENDING'),
  transactionCount: integer('transaction_count').notNull().default(0),
  processedCount: integer('processed_count').notNull().default(0),
  incidentsCreated: integer('incidents_created').notNull().default(0),
  baselineUpdated: boolean('baseline_updated').notNull().default(false),
  error: text('error'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ==================== SHOPIFY INTEGRATIONS ====================
// Per-org Shopify store connection. One org can have one Shopify store.
// Access tokens are stored AES-256-GCM encrypted at rest — never plaintext.

export const shopifyIntegrations = pgTable('shopify_integrations', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  storeId: text('store_id').references(() => stores.id, { onDelete: 'set null' }),
  shopDomain: varchar('shop_domain', { length: 255 }).notNull(),   // e.g. mystore.myshopify.com
  shopifyShopId: text('shopify_shop_id'),                           // GID: gid://shopify/Shop/xxx
  accessTokenEncrypted: text('access_token_encrypted').notNull(),   // AES-256-GCM, never plaintext
  scopes: text('scopes').notNull(),                                 // Comma-separated scopes granted
  status: text('status').notNull().default('ACTIVE'),               // ACTIVE | DISCONNECTED | ERROR
  installedAt: timestamp('installed_at').notNull().defaultNow(),
  uninstalledAt: timestamp('uninstalled_at'),
  lastWebhookAt: timestamp('last_webhook_at'),
  lastSyncAt: timestamp('last_sync_at'),
  syncStatus: text('sync_status').default('IDLE'),                  // IDLE | RUNNING | COMPLETED | FAILED
  syncStartedAt: timestamp('sync_started_at'),
  syncCompletedAt: timestamp('sync_completed_at'),
  syncCursor: text('sync_cursor'),                                  // Shopify cursor for resumable pagination
  syncError: text('sync_error'),                                    // Last sync error (truncated, no tokens)
  syncRecordsDiscovered: integer('sync_records_discovered').default(0),
  syncRecordsAccepted: integer('sync_records_accepted').default(0),
  syncRecordsDuplicates: integer('sync_records_duplicates').default(0),
  syncRecordsRejected: integer('sync_records_rejected').default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  orgUnique: uniqueIndex('shopify_integrations_org_domain_unique').on(t.organizationId, t.shopDomain),
  shopIdIdx: index('shopify_integrations_shop_id_idx').on(t.shopifyShopId),
  orgIdx: index('shopify_integrations_org_idx').on(t.organizationId),
}))

// Shopify webhook idempotency — prevents duplicate processing on retry
export const shopifyWebhookEvents = pgTable('shopify_webhook_events', {
  id: text('id').primaryKey(),
  integrationId: text('integration_id').notNull().references(() => shopifyIntegrations.id, { onDelete: 'cascade' }),
  shopDomain: varchar('shop_domain', { length: 255 }).notNull(),
  shopifyWebhookId: text('shopify_webhook_id').notNull(),           // X-Shopify-Webhook-Id header
  topic: text('topic').notNull(),                                   // orders/create, refunds/create, etc.
  processedAt: timestamp('processed_at').notNull().defaultNow(),
}, (t) => ({
  uniqueWebhook: uniqueIndex('shopify_webhook_events_unique').on(t.shopDomain, t.shopifyWebhookId),
}))

// ==================== API KEYS ====================
// Organization-scoped API credentials for machine-to-machine ingestion.
// Secret is shown only once at creation; only the hash is stored.

export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),                      // Human-readable label e.g. "Square POS Main"
  keyHash: text('key_hash').notNull(),               // bcrypt/sha256 hash — never store plaintext
  keyPrefix: varchar('key_prefix', { length: 8 }).notNull(), // First 8 chars for display: sg_live_ab12...
  storeId: text('store_id').references(() => stores.id), // Optional: scope to one store
  isActive: boolean('is_active').notNull().default(true),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  orgIdx: index('api_keys_org_idx').on(t.organizationId),
  activeIdx: index('api_keys_active_idx').on(t.organizationId, t.isActive),
}))

// ==================== BILLING EVENTS (webhook idempotency) ====================
export const billingEvents = pgTable('billing_events', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull().default('stripe'),
  providerEventId: text('provider_event_id').notNull(),
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at').notNull().defaultNow(),
  rawPayload: json('raw_payload'),
}, (table) => ({
  // CRITICAL: prevents duplicate webhook processing
  uniqueProviderEvent: uniqueIndex('billing_events_provider_event_unique')
    .on(table.provider, table.providerEventId),
}))

