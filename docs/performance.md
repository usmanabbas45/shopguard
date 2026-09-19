# ShopGuard Performance Results

Date: 2026-09-19
Environment: Node.js 22, in-process (no DB/Redis required for logic tests)

## Risk Engine

| Workload | Time | Result |
|---|---|---|
| 1,000 transactions, all rules | 7.7ms | ✅ (<200ms target) |
| 10,000 transactions, all rules | 50ms | ✅ (<2,000ms target) |
| Average per rule | 0.000ms | ✅ (<0.1ms target) |

Notes:
- 10 rules evaluated per transaction
- Baselines included in context
- No DB access in pure logic path

## CSV Processing

| Workload | Time | Result |
|---|---|---|
| Column detection, 20 headers | 0.11ms | ✅ (<5ms target) |
| 10,000 amount parses (PKR X,XXX format) | 3.7ms | ✅ (<100ms target) |
| 10,000 timestamp parses (4 formats) | 5.9ms | ✅ (<200ms target) |
| 1,000 row CSV inspect+map | 27.7ms | ✅ (<500ms target) |

## Incident Correlation

| Workload | Time | Result |
|---|---|---|
| 100 triggered transactions | 0.20ms | ✅ (<50ms target) |
| 1,000 triggered transactions | 11.2ms | ✅ (<500ms target) |

Algorithm: O(n²) correlation but fast in practice because:
- Time window filter eliminates most pairs immediately
- Typical incident rate is 2-5% of transactions

## Memory

| Workload | Memory Growth | Result |
|---|---|---|
| 50,000 risk evaluations | <50MB | ✅ No leak detected |

## Database Performance (Estimated, requires live DB)

Expected based on schema design:
- Transaction insert: ~1-2ms/row (with indexes)
- Import 10,000 rows: ~30-60 seconds (including validation)
- Baseline recalc (1 employee, 30d): ~50ms (PostgreSQL aggregate)
- Dashboard query: ~10-50ms (indexed by org+timestamp)
- Incident list (paginated): ~5-20ms (indexed by org+status)

## Scale Estimates

| Scale | Analysis Time | Notes |
|---|---|---|
| 10,000 transactions | ~25s | Baseline + rules + incidents |
| 100,000 transactions | ~4min | Batch processing 100/batch |
| 1,000,000 transactions | ~40min | Distributed worker recommended |

For 1M+ transactions:
- Use multiple analysis workers
- Enable BullMQ concurrency (currently set to 3)
- Consider partitioning by store for parallel processing

## Bottlenecks Identified

1. **Repeated DB lookups per transaction** — baseline fetch per transaction is O(n) DB calls.
   Mitigation: Cache baselines in-memory per analysis batch (already implemented in pipeline).

2. **N+1 on analysis** — each transaction fetches its own employee context.
   Mitigation: Pre-fetch all baselines for the org before batch analysis.

3. **Correlation is O(n²)** — acceptable up to ~10,000 triggered transactions per batch.
   For larger datasets, limit correlation window to 15 minutes and use spatial indexing.
