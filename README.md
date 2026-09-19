# ShopGuard

**Retail Transaction Intelligence** — Monitor POS activity, cash behavior, and employee patterns to surface unusual events before they become expensive problems.

> ShopGuard flags events. You decide what they mean.

## Quick Start

### Prerequisites
- Node.js 22+, pnpm 12+
- Docker + Docker Compose (for PostgreSQL + Redis)
- Python 3.12+ (for ML service)

### 1. Install dependencies

```bash
git clone https://github.com/yourorg/shopguard && cd shopguard
pnpm approve-builds --all
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit DATABASE_URL, SESSION_SECRET, etc.
```

### 3. Start services

```bash
docker compose up postgres redis -d
```

### 4. Run migrations and seed demo data

```bash
pnpm db:migrate          # Run Drizzle migrations
pnpm demo:seed           # Seed demo org + transactions
```

### 5. Start the application

```bash
# Terminal 1: Web app (workers start automatically in embedded mode)
pnpm --filter @shopguard/web dev
# → http://localhost:3000

# Terminal 2: BullMQ worker (optional in dev — embedded mode handles jobs)
pnpm --filter @shopguard/worker dev

# Terminal 3: ML service (optional, enhances detection)
cd apps/ml && pip install -r requirements.txt
uvicorn src.main:app --host 0.0.0.0 --port 8000
```

**Demo login**: `demo@shopguard.app` / `demo1234`

### Docker (production)

```bash
cp .env.example .env
# Set SESSION_SECRET and WORKER_SECRET to random 32+ char strings
docker compose up -d
```

All 5 services start automatically: `postgres`, `redis`, `ml`, `web`, `worker`.

## Running Tests

```bash
# TypeScript unit tests
pnpm --filter @shopguard/web test

# Python ML tests
cd apps/ml && python -m pytest tests/ -v

# TypeScript type check
pnpm --filter @shopguard/web typecheck

# Next.js build
DATABASE_URL="..." pnpm --filter @shopguard/web build
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the complete intelligence pipeline.

## Key Features

| Feature | Status |
|---|---|
| CSV auto-mapping (100+ column aliases) | ✅ |
| 10 modular detection rules | ✅ |
| Employee / store / time baselines | ✅ |
| Isolation Forest anomaly detection | ✅ |
| Supervised model (HistGradientBoosting) | ✅ |
| Incident correlation (30-min window) | ✅ |
| Human review + feedback labels | ✅ |
| ML training from reviewed incidents | ✅ |
| Candidate model quality gates | ✅ |
| Notification engine (email/WhatsApp) | ✅ |
| Automated follow-up scheduler | ✅ |
| Multi-tenant isolation | ✅ |
| Role-based access control | ✅ |
| Demo data (deterministic, isolated) | ✅ |
| ML admin page | ✅ |

## Product Rules

ShopGuard **never**:
- Says an employee committed fraud
- Shows raw ML probability scores
- Claims a transaction is definitely fraudulent
- Uses demo data for production ML training

ShopGuard **always**:
- Uses neutral language: "unusual activity", "requires review"
- Explains *why* an event was flagged
- Falls back gracefully when ML is unavailable
- Stops follow-ups immediately when an incident is reviewed
