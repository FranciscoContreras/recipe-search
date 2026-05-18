# VPS memory baseline (2026-05-17)

Captured before the Supabase → self-hosted Postgres migration. Sets the budget that every subsequent decision (worker count, `shared_buffers`, PgBouncer-or-not) must fit inside.

## Snapshot

```
total        used        free      shared  buff/cache   available
7.7 Gi       7.3 Gi      394 Mi    46 Mi   533 Mi       485 Mi
swap: 2.0 Gi / 2.0 Gi used
load avg: 0.19 0.22 0.24 (4 CPU cores)
uptime: 219 days, 7:23
```

`available` is the metric to watch — the kernel can reclaim some of `buff/cache`, so usable RAM is ~485 MB at the snapshot moment with swap fully consumed.

## Top consumers (RSS)

| PID | User | RSS | Process |
|---|---|---|---|
| 1253074 | `minecra+` | **3,383 MB** | Purpur Minecraft server (Java, -Xmx 4G, 6 d uptime) |
| 1201969 | `root` | 768 MB | `next-server (v15.4.11)` |
| 1201400 | `root` | 562 MB | `next-server (v15.4.11)` |
| 4047941 | `root` | 290 MB | `next-server (v15.4.11)` |
| 1453055 | `root` | 279 MB | `next-server (v15.4.11)` |
| 1426762/3/45/38 | `wearema+` | 4 × ~127 MB | `recipe-worker` × 4 (PM2) |
| 1144653 | `root` | 103 MB | `claude` (this session) |
| 1426714 | `wearema+` | 84 MB | `recipe-api` |
| 1606661 | `avion` | 74 MB | `avion.wearemachina.com` server |
| 1426713 | `wearema+` | 62 MB | `recipe-auditor` |

Recipe-base PM2 stack subtotal: ~550 MB. Trimming workers 4 → 2 saves ~250 MB (~5 % of total RAM).

## Current PostgreSQL tuning (Postgres 16.11, `off_mirror` DB)

| Setting | Current | Notes |
|---|---|---|
| `shared_buffers` | 128 MB | Postgres default; ~1.6 % of total RAM. Typical guidance is 25 %. Conservative is appropriate here. |
| `effective_cache_size` | 4 GB | Reasonable hint to the planner. |
| `work_mem` | 4 MB | Default. Per-sort/hash. Multiplied by concurrent operations. |
| `maintenance_work_mem` | 64 MB | Default. Used during VACUUM/CREATE INDEX. |
| `max_connections` | 100 | Plenty for our fleet (projected ~20 concurrent). |
| `wal_buffers` | 4 MB | Default; auto-tunes from shared_buffers. |
| `autovacuum_max_workers` | 3 | Default. |

`shared_preload_libraries` not readable as `off_user`. Will need root to confirm and to add `pg_cron`.

## Decision

**Proceed without adding swap.** The Minecraft server is the dominant consumer — that's a user-level decision outside this migration. The migration's resource delta after worker trim 4 → 2:

| Change | Δ RAM |
|---|---|
| Workers 4 → 2 | **−250 MB** |
| Drop `setInterval` auditor poll (one query / 5 min instead of every 10 s) | negligible |
| Add `pg_cron` background worker | +5–10 MB |
| Add `pgvector` extension (loaded, not used) | +2–5 MB |
| Add a second small DB (`recipe_base`) — files only, no resident memory | negligible |
| `shared_buffers` bump (deferred — keep at 128 MB) | 0 |

Net: roughly **−240 MB** = available RAM rises from ~485 MB to ~725 MB. Acceptable margin.

**Defer**: `shared_buffers` tuning, swap expansion, Minecraft eviction. All are escape hatches if real-world load shows pressure post-cutover.

## Action items for the user

- (Optional) Consider whether the Minecraft server should keep running on this VPS — it's ~44 % of total RAM. Doesn't block the migration.
- Decide whether to dedicate any of those `next-server` processes — there are 5 separate Next.js servers from different deploys (likely different tenants on this CloudPanel box). Total ~2 GB.

No swap-add required to proceed.
