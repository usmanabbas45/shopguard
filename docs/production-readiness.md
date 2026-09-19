# ShopGuard — Production Readiness Report

**Date:** 2026-09-19  
**Verified by:** Code inspection + live HTTP tests + unit/ML test execution

---

## Test Results — All Executed

| Suite | Count | Status |
|---|---|---|
| TypeScript unit tests | 171 | ✅ All pass |
| Python ML + drift tests | 27 | ✅ All pass (0 warnings) |
| TypeScript type check | — | ✅ 0 errors |
| Next.js build | 36 routes | ✅ Succeeds |
| Live HTTP security tests | 25 | ✅ 25/25 pass (with live server) |
| E2E Playwright | — | ⚠️ Blocked (no PostgreSQL in build env) |

---

## Bugs Found and Fixed This Verification Pass

### Critical

**1. `processFollowUps()` fired on ALL open incidents, not just due ones**  
The function queried every open incident with `followUpCount < 3` but never checked `nextFollowUpAt`. Every scheduler run would have sent follow-up notifications to every open incident in the system.  
**Fixed:** Added `sql\`next_follow_up_at IS NOT NULL\`` and `sql\`next_follow_up_at <= ${now}\`` to the Drizzle query.

**2. Middleware blocked worker requests before route saw them**  
`/api/analysis` was in `PROTECTED_API_PREFIXES`, so the middleware returned 401 for every request before the route's worker-key auth check ran. The standalone worker could never authenticate.  
**Fixed:** Removed `/api/analysis` from `PROTECTED_API_PREFIXES`. The route handles all auth itself (user session OR worker key).

**3. Standalone worker's `analyze_batch` action didn't exist**  
The worker called `/api/analysis` with `action: 'analyze_batch'` but the Zod enum only accepted 3 other actions → 400 on every analysis job.  
**Fixed:** Added `analyze_batch` to the enum.

**4. Standalone worker analysis handler called non-existent `/api/_worker/analysis`**  
Dead import attempt left in from previous implementation.  
**Fixed:** Removed.

**5. `startWorkers()` / `startScheduler()` never called**  
Both were exported but nothing called them. Jobs queued to Redis but no consumer ran.  
**Fixed:** Created `src/instrumentation.ts` (Next.js 15 native hook). Respects `WORKER_MODE=standalone`.

**6. `export const runtime = 'nodejs'` in middleware broke all responses**  
This directive caused the Next.js production server to return `HTTP 200` with empty body on every request — including auth-protected routes that should return 401.  
**Fixed:** Removed. Middleware runs at Edge (default). Rate limit map note added.

### Security

**7. `incidentReviews` not scoped to organization in ML stats route**  
`/api/admin/ml/stats` queried `incidentReviews` without any `WHERE organizationId = ?`. An admin from Org A could see Org B's review counts.  
**Fixed:** Added `.innerJoin(incidents, eq(incidents.id, incidentReviews.incidentId)).where(eq(incidents.organizationId, orgId))`.

**8. Worker baseline handler called API with no auth**  
The standalone worker's `handleBaseline` function called `/api/analysis` without an `x-worker-key` header.  
**Fixed:** Header added.

**9. Worker auth returned 401 even with valid key (middleware intercepted first)**  
See Bug #2 above.

### Data Safety

**10. No CSV row limit**  
The import route would attempt to process unlimited rows in a single synchronous request.  
**Fixed:** `MAX_ROWS = 100_000` check before processing.

**11. No CSV formula injection protection**  
Values starting with `=`, `+`, `-`, `@`, tab, CR were passed through unmodified.  
**Fixed:** `sanitize()` function prefixes dangerous values with `'`.

**12. Login error logged full stack trace in production**  
`console.error('[login]', err)` would print the full `Error: connect ECONNREFUSED ...` with stack in production logs.  
**Fixed:** In production mode, only the first line of the error message is logged.

### Dependencies

**13. BullMQ `@valkey/valkey-glide` webpack warning**  
Optional dependency caused noisy build output.  
**Fixed:** Added `resolve.alias: { '@valkey/valkey-glide': false }` in `next.config.ts`.

---

## Security Audit Results

### API Authorization (verified live)
- 9/9 protected API endpoints return 401 without session ✅
- Worker key authentication: bad key → 401, valid key → processes ✅
- Worker with missing `organizationId` → 400 ✅
- Webhook with no auth header → 401 ✅
- Login error body contains no internal details ✅

### Security Headers (verified live)
- `X-Frame-Options: DENY` ✅
- `X-Content-Type-Options: nosniff` ✅
- `Referrer-Policy: strict-origin-when-cross-origin` ✅
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` ✅

### Tenant Isolation (code verified)
- All DB queries scoped with `eq(table.organizationId, orgId)` ✅
- `incidentReviews` join-scoped through `incidents` ✅
- Analysis pipeline enforces org scope ✅
- Demo data gated on `session.isDemo` ✅
- ML training excludes `isDemo = true` records ✅

### Input Validation (verified live)
- Empty email → 400 ✅
- Short password → 400 ✅
- Empty org name → 400 ✅
- Bad credentials → 401 (not 200) ✅
- DB unavailable → 503 (not 500 with details) ✅

---

## Automation Status

| Capability | Implemented | Automated | Notes |
|---|---|---|---|
| Signup | ✅ | N/A | Manual user action |
| CSV import | ✅ | N/A | Manual user action |
| Normalization | ✅ | ✅ | On import |
| Baseline calculation | ✅ | ✅ | BullMQ after import + daily |
| Analysis / rules | ✅ | ✅ | BullMQ after import |
| ML inference | ✅ | ✅ | If ML_SERVICE_URL configured |
| Incident correlation | ✅ | ✅ | In analysis pipeline |
| Incident creation | ✅ | ✅ | In analysis pipeline |
| Notifications | ✅ (mock) | ✅ | Real on SMTP_HOST configured |
| Follow-ups | ✅ | ✅ | Every 30min via scheduler |
| Follow-up stop on review | ✅ | ✅ | Status check before send |
| Daily reports | ✅ | ✅ | Daily @06:00 UTC |
| Data quality checks | ✅ | ✅ | Daily + after import |
| ML drift detection | ✅ | ✅ | Daily via scheduler |
| Model training | ✅ | ❌ | Admin must trigger manually |
| Model evaluation | ✅ | ❌ | Admin must trigger manually |
| Model deployment | ✅ | ❌ | Admin must trigger manually (quality gate enforced) |
| Model rollback | ✅ | ❌ | Admin must trigger manually |
| Health checks | ✅ | ✅ | Every 5min via scheduler |
| Audit logging | ✅ | ✅ | Automatic on key operations |

---

## Known Limitations

| Item | Status |
|---|---|
| WhatsApp delivery | Mock only — no WABA integration |
| Email delivery | Mock unless `SMTP_HOST` configured |
| Real-time POS webhooks | Interface exists, no live POS integrations |
| ML model training | Manual trigger only |
| E2E Playwright tests | Written, blocked by no live DB in build env |
| Rate limiting | In-process Map only; resets on restart |
| Multi-instance rate limit | Not implemented (use @upstash/ratelimit for that) |
| Webhook API key model | API key = organizationId (simplified V1) |

---

## Production Readiness: **READY WITH CONFIGURATION**

Required configuration before deployment:

```bash
# Required
DATABASE_URL=postgresql://user:pass@host:5432/shopguard
REDIS_URL=redis://host:6379
SESSION_SECRET=<random 32+ char string>
WORKER_SECRET=<random 32+ char string, same in web + worker>
NODE_ENV=production

# In web container (when using separate worker container)
WORKER_MODE=standalone

# Optional — mock providers used if not set
ML_SERVICE_URL=http://ml:8000
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=alerts@yourdomain.com
SMTP_PASS=<smtp password>
SMTP_FROM=alerts@yourdomain.com
```

---

## Startup Commands

```bash
# Docker (recommended)
cp .env.example .env
# Edit .env: fill SESSION_SECRET and WORKER_SECRET
docker compose up -d

# Verify
curl http://localhost:3000/api/health

# Demo account
# Email: demo@shopguard.app
# Password: demo1234

# Manual (development)
docker compose up postgres redis -d
psql $DATABASE_URL < packages/database/migrations/0001_initial.sql
pnpm demo:seed
pnpm --filter @shopguard/web dev          # Terminal 1
pnpm --filter @shopguard/worker dev       # Terminal 2
cd apps/ml && uvicorn src.main:app --port 8000  # Terminal 3 (optional)

# Tests
pnpm test
cd apps/ml && python3 -m pytest tests/ -q
```
