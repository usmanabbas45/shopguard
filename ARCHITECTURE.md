# ShopGuard Architecture

## Overview

ShopGuard is a multi-tenant retail transaction intelligence SaaS.
It sits above existing POS systems and analyzes transaction data to detect unusual activity.

## Key Principles

1. **Never accuse** — neutral language only: "unusual activity", "requires review"
2. **Always explain** — every incident shows exactly why it was flagged
3. **Human review is final** — the system surfaces; humans decide
4. **Learn from feedback** — reviewed incidents become training data
5. **Graceful degradation** — ML failure never breaks transaction analysis

## Stack

```
Next.js 15 (App Router)     — Frontend + API routes
Drizzle ORM                 — Database access layer
PostgreSQL                  — Primary database
Redis (optional)            — Job queue (BullMQ-ready)
Python FastAPI              — ML inference service
scikit-learn                — Isolation Forest + HistGradientBoosting
```

## Intelligence Pipeline

```
CSV Upload
  ↓
Column Auto-Detection (100+ aliases, 17 normalized fields)
  ↓
Validation (future timestamps, negative amounts, duplicates)
  ↓
Normalization (unified Transaction model)
  ↓
Baseline Calculation (employee / store / register / time)
  ↓
Feature Generation (23 behavioral features per transaction)
  ↓
Rule Engine (10 modular rules, structured evidence)
  ↓
ML Anomaly Detection (Isolation Forest → HistGradientBoosting)
  ↓
Risk Aggregation (rules 60% + ML 20% + baselines 20%)
  ↓
Incident Correlation (30-min window, same employee/register)
  ↓
Incident Creation (title, summary, whyFlagged[], evidence[])
  ↓
Notification (email/WhatsApp, provider-agnostic)
  ↓
Human Review (VALID / FALSE_POSITIVE / NEEDS_INVESTIGATION / INSUFFICIENT)
  ↓
Training Dataset (reviewed incidents + feature snapshots)
  ↓
Candidate Model (quality gates before deployment)
  ↓
Production Model (never auto-replace without gates passing)
```

## Baseline System

Rolling windows: 7d, 14d, 30d, 60d, 90d
Confidence: LOW (<20 samples) / MEDIUM / HIGH

Employee baseline: void_rate, refund_rate, discount_rate, avg_amount, tx_per_hour
Store baseline: avg_amount, void_rate, hourly_volume, dow_volume
Register baseline: no_sale_rate, void_rate, refund_rate
Time baseline: per hour × day-of-week, minimum 2 weeks of data

Rules use baselines to compare current behavior against historical norms.
LOW confidence baselines do NOT generate aggressive alerts.

## ML Stages

Stage 1 — Rules (always active, deterministic)
Stage 2 — Statistical baselines (always active)
Stage 3 — Isolation Forest (unsupervised, no labels needed, 100+ samples)
Stage 4 — HistGradientBoosting (supervised, 20+ positive + 50+ negative labels)

ML failure → graceful fallback to rules + baselines.
ML scores are never shown raw to users.

## Multi-Tenancy

Every DB table scoped by organizationId.
API layer enforces tenant isolation (never trusts frontend).
Roles: OWNER > ADMIN > MANAGER > INVESTIGATOR > VIEWER
Demo data isolated from production (isDemo flag, separate training).

## Follow-up Automation

HIGH: immediate → 4h → 24h → stop on review
MEDIUM: 24h reminder → stop on review
LOW: daily summary → stop on review
Max 3 follow-ups; stops immediately when incident is reviewed.
