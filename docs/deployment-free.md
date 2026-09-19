# ShopGuard Free Staging Deployment Guide

## Architecture

```
Browser
  ↓
Vercel (Next.js + API routes + embedded BullMQ worker via Upstash)
  ├── Neon PostgreSQL (free, no card)
  ├── Upstash Redis (free, no card)
  └── Render Python ML service (free, card required for Render account)
```

**Worker note:** On Vercel the BullMQ worker runs embedded (WORKER_MODE=embedded). 
Because Vercel functions are stateless, analysis jobs run inline during the API request 
when no persistent worker is consuming the queue. This is the existing fallback path — 
tested and working. Heavy imports may be slightly slower but everything functions correctly.

---

## Free Tier Limits

| Service | Free limit | Card needed? |
|---|---|---|
| Vercel Hobby | 100GB bandwidth, 60s function timeout | No |
| Neon | 0.5GB storage, 190 compute-hours/month, autosuspends 5min | No |
| Upstash | 10,000 commands/day, 256MB | No |
| Render | 750 hours/month, sleeps 15min inactivity | Yes (account verification) |

**If you don't want to give Render a card:** Leave `ML_SERVICE_URL` blank.  
ShopGuard uses rules + baselines only — fully functional, no ML inference.

---

## Step-by-Step Deployment

### Step 1 — Fork / Push to GitHub

1. Create a GitHub account at github.com if you don't have one
2. Create a new repository: `shopguard`
3. Upload the project files (or push with git):
```bash
cd /path/to/shopguard
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/shopguard.git
git push -u origin main
```

### Step 2 — Neon PostgreSQL (Free, No Card)

1. Go to **https://neon.tech** → click **Sign Up** → use GitHub login (no card)
2. Create a new project: name it `shopguard-staging`
3. Select region: **AWS / ap-southeast-1 (Singapore)** (close to Pakistan)
4. After project creation, go to **Connection Details**
5. Copy the **Connection string** — it looks like:
   `postgresql://user:password@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
6. Also copy the **Pooled connection string** (has `-pooler` in the hostname) — use this for Vercel

**Run migrations:**
```bash
# On your local machine with the Neon URL:
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require" \
  pnpm --filter @shopguard/database run migrate

# Then seed demo data:
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require" \
  pnpm --filter @shopguard/database run demo:seed
```

### Step 3 — Upstash Redis (Free, No Card)

1. Go to **https://upstash.com** → click **Sign Up** → use GitHub login (no card)
2. Click **Create Database**
3. Name: `shopguard-staging`
4. Type: **Regional** → Region: **ap-southeast-1 (Singapore)**
5. Click **Create**
6. On the database page, click **Details** tab
7. Copy the **Redis URL** — it looks like:
   `rediss://default:YOUR_TOKEN@loving-xxx.upstash.io:6379`

### Step 4 — Vercel (Free, No Card)

1. Go to **https://vercel.com** → click **Sign Up** → use GitHub login (no card)
2. Click **Add New Project**
3. Import your `shopguard` GitHub repository
4. Vercel auto-detects Next.js. **Before clicking Deploy**, set environment variables:

Click **Environment Variables** and add ALL of these:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Neon **pooled** connection string |
| `DATABASE_MAX_CONNECTIONS` | `1` |
| `REDIS_URL` | Your Upstash Redis URL |
| `SESSION_SECRET` | Any random 32+ char string (e.g. run `openssl rand -hex 32`) |
| `WORKER_MODE` | `embedded` |
| `WORKER_SECRET` | Any random 32+ char string |
| `NODE_ENV` | `production` |
| `NEXT_PUBLIC_APP_URL` | Leave blank for now — fill in after first deploy |
| `ML_SERVICE_URL` | Leave blank (or fill after Step 5) |

5. Under **Build & Output Settings**:
   - Framework Preset: **Next.js** (auto-detected)
   - Root Directory: `.` (leave as default)
   - Build Command: `pnpm --filter @shopguard/types build && pnpm --filter @shopguard/web build`
   - Output Directory: `apps/web/.next` (auto from vercel.json)

6. Click **Deploy**
7. Wait 2–3 minutes for build to complete
8. Copy your deployment URL (e.g. `https://shopguard-abc123.vercel.app`)
9. Go to **Settings → Environment Variables** → update `NEXT_PUBLIC_APP_URL` to your URL
10. Redeploy: **Deployments → three dots → Redeploy**

### Step 5 — Render Python ML Service (Optional, Needs Card)

> If you don't have a card or don't want to provide one, skip this step.
> ShopGuard works fully without the ML service — rules and baselines still run.

1. Go to **https://render.com** → click **Sign Up** → use GitHub login
2. Render will ask for card verification (required even for free tier)
3. Click **New** → **Web Service**
4. Connect your GitHub `shopguard` repository
5. Configure:
   - **Name:** `shopguard-ml`
   - **Root Directory:** `apps/ml`
   - **Runtime:** Python 3
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn src.main:app --host 0.0.0.0 --port $PORT`
   - **Plan:** Free
6. Add environment variable: `ML_MODEL_DIR` = `/tmp/shopguard_models`
7. Click **Create Web Service**
8. Wait for deploy (3–5 min)
9. Copy your ML service URL: `https://shopguard-ml-xxxx.onrender.com`
10. Go back to Vercel → **Settings → Environment Variables** → set `ML_SERVICE_URL` to the Render URL
11. Redeploy Vercel

---

## Environment Variables Reference

```bash
# Required
DATABASE_URL=postgresql://user:pass@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
DATABASE_MAX_CONNECTIONS=1
REDIS_URL=rediss://default:token@loving-xxx.upstash.io:6379
SESSION_SECRET=<openssl rand -hex 32>
WORKER_SECRET=<openssl rand -hex 32>
WORKER_MODE=embedded
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://shopguard-xxx.vercel.app

# Optional (leave blank to use mock/disabled)
ML_SERVICE_URL=https://shopguard-ml-xxx.onrender.com
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
```

---

## Demo Login

After deployment and seeding:
- **URL:** `https://shopguard-xxx.vercel.app`
- **Email:** `demo@shopguard.app`
- **Password:** `demo1234`

---

## Running E2E Tests Against Staging

```bash
cd apps/web
PLAYWRIGHT_BASE_URL=https://shopguard-xxx.vercel.app pnpm test:e2e
```

---

## Known Limitations of Free Tier

1. **Neon autosuspends after 5 min of inactivity** — first request after sleep takes 3–8 seconds.
   The app handles this with `connect_timeout: 30`.

2. **Render ML service sleeps after 15 min** — first ML inference after sleep takes 30–60 seconds.
   The app shows the analysis result using rules only while ML wakes up.

3. **Vercel function timeout: 60 seconds** — large CSV imports (100k rows) may timeout.
   Imports are chunked via BullMQ but inline fallback may hit the limit on huge files.
   Keep demo imports under 5,000 rows.

4. **Upstash 10k commands/day** — each BullMQ job uses ~5–10 commands.
   This supports ~1,000–2,000 background jobs per day on the free tier.

5. **Worker is embedded (not persistent on Vercel)** — analysis runs inline during the
   API request. This works correctly but means there's no background processing after
   the response returns. Jobs queued in Redis are consumed by the next request that
   processes them, or by the inline fallback path.

---

## DNN / ML Safety (unchanged)

- Demo data is flagged `isDemo: true` — excluded from production ML training
- DNN training requires ≥100 human-reviewed incidents — disabled on fresh deploy
- ML service unavailable → rules + baselines continue (tested and verified)
- No fake metrics are shown

---

## Estimated Monthly Cost

| Service | Cost |
|---|---|
| Vercel Hobby | $0 |
| Neon Free | $0 |
| Upstash Free | $0 |
| Render Free (ML) | $0 |
| **Total** | **$0** |

This is accurate as of September 2026 assuming:
- Under 100GB Vercel bandwidth
- Under 0.5GB Neon storage
- Under 10k Upstash commands/day
- ML service running on Render's 750 free hours/month (1 service = all 750 hours)

