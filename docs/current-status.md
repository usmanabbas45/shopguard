# ShopGuard Current Status — Audit

Date: 2026-09-18

## Environment Notes

PostgreSQL and Redis are NOT available in this build environment.
The application targets a Docker Compose environment with both services.
All code is written for PostgreSQL + Redis; unit tests use in-memory implementations.

## What Actually Works (Code Complete, Builds)

### ✅ Monorepo Structure
- pnpm workspace with packages/database, packages/types, apps/web, apps/api (stub), apps/ml (empty), workers/*
- TypeScript: 0 errors
- Next.js build: succeeds, all routes compile

### ✅ Database Schema (schema.ts, 426 lines)
Tables: organizations, orgSettings, users, sessions, memberships, invitations,
stores, registers, employees, transactions, cashSessions, incidents, incidentEvidence,
incidentTransactions, incidentReviews, employeeBaselines, storeBaselines,
importJobs, importMappings, dataQualityIssues, notificationPreferences,
notificationAttempts, reports, auditLogs, ruleConfigs, subscriptions

MISSING FROM SCHEMA:
- registerBaselines
- modelVersions / trainingDatasets / trainingRuns
- featureSnapshots
- incidentRelations (correlation table)
- jobLogs

### ✅ Authentication
- Signup: creates user, org, membership, session cookie
- Login: validates bcrypt hash, creates session
- Logout: deletes session
- getSession(): cookie → DB lookup → SessionUser
- Role hierarchy enforced

### ✅ Risk Engine (429 lines)
10 rules implemented: void_after_cash, no_sale_drawer, repeated_voids, large_refund,
rapid_sale_refund, excessive_discount, price_override, after_hours, unusual_amount,
cash_variance
Rules return structured: {ruleId, triggered, severity, evidence, scoreContribution}
evaluateRisk() combines scores → {ruleScore, baselineScore, mlScore, totalScore, riskLevel}

PROBLEMS:
- Risk engine NOT connected to import pipeline (imports save txns, no analysis runs)
- No incident creation from rule evaluation
- No correlation logic
- Baselines not calculated after import

### ✅ CSV Import (inspection + processing)
- inspect: auto-detects 17 fields from 100+ aliases
- process: inserts transactions, creates employees/stores/registers on the fly
- No post-import analysis trigger

### ✅ Frontend Pages
- Landing page, Login, Signup, Dashboard, Incidents (list+detail), Import, Employees, Stores, Cash, Reports, Settings
- All use DEMO DATA for non-connected real data
- Dashboard: uses demo data for demo org; partial real query for real orgs (incomplete)

### ✅ Demo Data Generator
- deterministic seed (42), 60 days × 3 stores × ~100 tx/day
- 3 injected anomalies documented
- Demo seed script: creates demo user + org + stores + employees + transactions

## What Is Incomplete / Missing

### 🔴 Critical Missing

1. **Post-import analysis pipeline** — importing CSV does NOT run rules, create incidents, or calculate baselines
2. **Baseline calculation service** — employeeBaselines/storeBaselines tables exist but nothing writes to them
3. **Incident creation** — incidents table exists but nothing automatically creates incidents
4. **ML service** — apps/ml/ is empty directory
5. **Background jobs** — workers/* are empty; no BullMQ/queue implementation
6. **Notification engine** — notificationAttempts table exists but nothing sends notifications
7. **Follow-up scheduler** — schema fields exist (nextFollowUpAt, followUpCount) but no scheduler

### 🟡 Incomplete

8. **Dashboard** — real org dashboard queries are incomplete (partial SQL)
9. **Employee analytics** — page uses hardcoded demo data, not DB
10. **Store analytics** — page uses hardcoded demo data, not DB
11. **Cash page** — uses hardcoded demo data, not DB
12. **Schema gaps** — missing registerBaselines, modelVersions, featureSnapshots, incidentRelations

### 🟠 Not Started

13. Python ML service (Isolation Forest)
14. Model versioning / registry
15. Training dataset pipeline
16. Supervised model (HistGradientBoosting)
17. Model monitoring page (/admin/ml)
18. Real-time POS adapter interface
19. Automated daily workflow
20. Security test (cross-tenant access)
21. Unit tests (none exist)

## Architecture Assessment

The foundation is SOUND:
- Schema is well-designed and nearly complete
- Risk engine rules are correct and modular
- CSV import logic is solid
- Auth/tenancy is correct
- Next.js App Router structure is clean

The main gap: the pipeline connecting imports → analysis → incidents → notifications
is entirely missing. The components exist in isolation but don't connect.

## Plan

Implement in this priority order:
1. Add missing schema tables + migration
2. Baseline calculation service
3. Post-import analysis pipeline (rules → incidents)
4. Incident correlation
5. Real dashboard/employee/store data
6. Background job runner (in-process for V1, BullMQ-ready)
7. Notification engine (mock provider)
8. Follow-up scheduler
9. Python ML service (Isolation Forest)
10. Model versioning
11. Training pipeline
12. Admin/ML page
13. Tests
14. Documentation
