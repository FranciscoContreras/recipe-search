# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `recipe-api/`:

```bash
npm run dev      # Development: nodemon + ts-node (hot-reload)
npm run build    # Compile TypeScript → dist/
npm start        # Run compiled output (dist/index.js)
```

Scripts in `src/scripts/` are one-off utilities run with `ts-node src/scripts/<file>.ts`.

**Generating an API key** — run from `recipe-api/` against the live `recipe_base` DB:

```bash
DATABASE_URL=postgresql://recipe_app:<pw>@localhost:5432/recipe_base \
  npx ts-node src/scripts/generate_key.ts "owner-name" "owner@email.com"
```

The script inserts a SHA-256-hashed key row directly via `pg` and emails the plaintext key via Resend.

**Production audit** (read-only checks against the live DB):
```bash
API_KEY=sk_... npx ts-node src/scripts/production_audit.ts
```

**Applying migrations**:
```bash
DATABASE_URL=postgresql://recipe_app:<pw>@localhost:5432/recipe_base \
  npx ts-node src/scripts/migrate.ts
```
Tracks applied filenames in `schema_migrations` so re-runs are no-ops.

```bash
npm test              # Run Jest unit tests (60 tests across 5 suites)
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

Tests live in `src/__tests__/`. The `db/queries.ts` module is mocked in tests that import `NutritionEngine` — see `units.test.ts` for the pattern.

## Architecture

The project is a Node.js/TypeScript Express API deployed on a VPS at `recipe-base.wearemachina.com`. There is no frontend framework — the UI is static HTML served from `public/`. **Everything runs on the VPS** — Postgres, the API, the worker, the auditor, and the backups. There is no Supabase, no managed Postgres, and no PostgREST in the path. The app talks to Postgres over a local Unix socket / loopback TCP via the `pg` driver.

### Three PM2 processes (defined in `ecosystem.config.js`)

| Process | Entry | Purpose |
|---|---|---|
| `recipe-api` | `dist/index.js` | Express HTTP server, port 3034 |
| `recipe-worker` | `dist/worker.js` | 2 LISTEN/NOTIFY-driven crawl job consumers |
| `recipe-auditor` | `dist/auditor.js` | Thin loop that wakes pg_cron-scheduled work |

The worker count dropped from 4 → 2 in the self-host migration to fit the VPS memory budget (see `docs/runbooks/memory_baseline.md`). Most periodic work (stats refresh, audit batches) moved into `pg_cron` and runs inside Postgres itself.

### Request flow

All routes are defined in `src/index.ts`. The `apiKeyAuth` middleware (mounted with `app.use`) guards every route defined **after** it. Routes defined before the middleware are public.

**Public:** `/`, `/health`, `/auth/request-key`, `/api-docs`, static files, `/recipe/:id` (SSR), `/robots.txt`, `/sitemap.xml`

**Protected (require `x-api-key` header):** `/recipes`, `/search`, `/nutrition/analyze`, `/crawl`, `/jobs`

### Auth system (`src/middleware/auth.ts`)

API keys are stored SHA-256-hashed in the `api_keys` table. The middleware uses the shared `pg.Pool` (from `src/db/pool.ts`) — there is no separate "service role" connection; RLS is disabled in the self-hosted DB so the `recipe_app` role can read `api_keys` directly. Validated keys are cached in-process for 1 minute to reduce DB load. Key generation and email delivery are handled by `src/controllers/authController.ts` + `src/services/email.ts` (Resend).

### Crawl pipeline (LISTEN/NOTIFY, not polling)

1. Client POSTs a URL to `/crawl` → inserts a `crawl_jobs` row with `status: 'pending'`.
2. A trigger (`notify_crawl_job`, installed by migration `20260517000000_self_host_compat.sql`) fires `pg_notify('crawl_jobs_new', NEW.id::text)` for every new pending row.
3. Each `recipe-worker` holds a dedicated `pg.Client` (in `src/db/listenClient.ts`) that has issued `LISTEN crawl_jobs_new`. The notification wakes the worker in ≈ 50 ms.
4. The worker claims a job with `UPDATE crawl_jobs SET status='processing' WHERE id = (SELECT id FROM crawl_jobs WHERE status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *;` — `SKIP LOCKED` lets multiple workers compete without ever blocking each other.
5. A 60-second polling fallback inside the worker catches the rare dropped notification.
6. Failed jobs enter `status: 'cooling_down'` with a `next_retry_at` timestamp for retry logic.

### Nutrition engine (`src/services/nutritionEngine.ts`)

`NutritionEngine.analyze(ingredients[])` parses natural-language ingredient strings using the `parse-ingredient` library, converts volumetric units to grams via an internal density table (`DENSITY_TABLE`), then queries USDA and FatSecret APIs for per-ingredient macros. On `GET /recipes/:id`, if a recipe has no stored nutrition, enrichment is queued via `src/utils/background.ts` (tracked fire-and-forget — drained on `SIGTERM`).

### Database

Self-hosted **PostgreSQL 16** on the VPS, two databases in one cluster:

- `recipe_base` — the application DB. Owned by role `recipe_owner`; written by `recipe_app`; read-only access via `recipe_readonly`.
- `off_mirror` — the Open Food Facts mirror. Used by `src/services/openFoodFacts.ts` via `src/offDbClient.ts`. Unchanged by the migration.

Both DBs are accessed through `pg.Pool` instances:

- `src/db/pool.ts` — single shared pool for `recipe_base`, env-driven (`DATABASE_URL`, `PG_POOL_MAX`).
- `src/db/listenClient.ts` — dedicated session connection for `LISTEN/NOTIFY` (cannot share a pool because LISTEN is session-scoped).
- `src/db/queries.ts` — typed per-call-site query functions; everywhere the old code did `supabase.from(...)`, the new code calls a named function here. Types live in `src/db/types.ts` (hand-written; the old generated `database.types.ts` is gone).
- `src/offDbClient.ts` — separate pool for `off_mirror`.

Migrations live in `supabase/migrations/` (legacy directory name; we keep it). They are applied by `src/scripts/migrate.ts`, which tracks filenames in a `schema_migrations` table — re-runs are no-ops. The migration `20260517000000_self_host_compat.sql` is the bridge to self-host: drops RLS, creates the LISTEN/NOTIFY trigger, registers `pg_cron` schedules, and installs the `audit_pending_batch(int)` SQL function.

`pg_cron` schedules (queryable via `SELECT * FROM cron.job;`):

| Job | Schedule | What it does |
|---|---|---|
| `refresh-recipe-stats` | `*/5 * * * *` | Refreshes the recipe stats materialized view |
| `audit-batch` | `*/5 * * * *` | Audits the next 10 pending recipes via `audit_pending_batch(10)` |

Key SQL-side functions still in use:

- `search_recipes_hybrid` — combines pgvector semantic search with full-text search
- `update_recipe_nutritions` — batch upsert for nutrition data
- `audit_pending_batch(n)` — picks the next `n` un-audited recipes, runs the audit logic inline, marks them done (defined in the self-host compat migration)

### Deployment

GitHub Actions (`.github/workflows/deploy.yml`) triggers on push to `main`: builds TypeScript, rsyncs to the VPS (excluding `node_modules`, `.env`), then runs `pm2 reload ecosystem.config.js` as the site user. The `.env` on the VPS uses `DATABASE_URL` (not SUPABASE_*), so the deploy never touches credentials — they were provisioned once by `scripts/vps/02_create_db_and_roles.sh`.

### Environment variables

Required in `recipe-api/.env` (see `recipe-api/.env.example` for a working template):

- `DATABASE_URL` — `postgresql://recipe_app:<pw>@localhost:5432/recipe_base`. Provisioned by `scripts/vps/02_create_db_and_roles.sh`; the script prints it on first run.
- `PG_POOL_MAX` (default 10) — max clients in each Node process's `pg.Pool`.
- `OFF_DB_URL` — `postgresql://off_user:<pw>@localhost:5432/off_mirror`. Used by `src/offDbClient.ts`.
- `FATSECRET_CLIENT_ID`, `FATSECRET_CLIENT_SECRET` — IP-whitelisted; register production server's IP in FatSecret developer dashboard
- `USDA_API_KEY` — register a **separate key for local dev** at https://fdc.nal.usda.gov/api-key-signup so production quota isn't shared
- `API_NINJAS_KEY` — **not used in production chain** (free tier blocks calories + protein — premium required). Key stored but service returns null unless upgraded.
- `RESEND_API_KEY`
- `PORT` (defaults to 3000; production uses 3034 via PM2)
- `HEALTHCHECK_WEBHOOK` (optional) — used by `scripts/vps/05_health_check.sh` to POST failure events.

### Nutrition source chain (in lookup order)

```
Cache (ingredient_cache table, v11:*)
  → USDA FoodData Central  — raw ingredients, per-100g, unlimited, no IP restriction
  → Open Food Facts         — packaged/branded goods, 4M+ products, no key required
  → FatSecret               — production only (IP whitelisted), 2.3M foods
```

Packaged ingredient detection (keywords: `can`, `tin`, `jar`, `bottle`, etc.) routes OFF before USDA.

New endpoint: `POST /nutrition/barcode` — looks up any EAN-13/UPC-A barcode via Open Food Facts, returns per-100g + scaled-to-amount nutrition + Nutri-Score grade.

### Open Food Facts local mirror (`off_products` table)

Instead of hitting the OFF API on every request (prone to 503s), the full product database is mirrored locally in the VPS Postgres cluster (`off_mirror` database). Set `OFF_DB_URL=postgresql://off_user:<pw>@localhost:5432/off_mirror` in `.env`. The app uses VPS Postgres for OFF queries (local socket, <1ms) and falls back to the live API for products not yet in the mirror.

```bash
# First-time import (~900 MB download, 10-30 min, populates ~1-2M products with nutrition)
OFF_DB_URL=postgresql://off_user:<pw>@localhost:5432/off_mirror \
  npx ts-node src/scripts/sync_off.ts full

# Weekly delta sync (applies last 7 days of changes, run via cron)
OFF_DB_URL=postgresql://off_user:<pw>@localhost:5432/off_mirror \
  npx ts-node src/scripts/sync_off.ts delta

# Or last N days
OFF_DB_URL=postgresql://off_user:<pw>@localhost:5432/off_mirror \
  npx ts-node src/scripts/sync_off.ts delta --days 14
```

After `full` import: text search and barcode lookups hit the local `off_products` table (sub-ms, no 503s). Live OFF API is only called for products not yet in the mirror.

VPS setup (run once on the server):
```bash
createdb off_mirror
psql off_mirror < supabase/migrations/20260511000001_off_products_table.sql
psql off_mirror < supabase/migrations/20260511000002_off_products_expand_schema.sql
OFF_DB_URL=postgresql://off_user:<pw>@localhost:5432/off_mirror \
  npx ts-node src/scripts/sync_off.ts full
```

## Backups

Backups are produced on the VPS itself by `scripts/vps/03_backup_nightly.sh`, installed at `/usr/local/bin/recipe-backup-nightly.sh` and scheduled via `/etc/cron.d/recipe-backup` (see `scripts/vps/README.md` for the exact cron snippet).

**Where dumps live** (`pg_dump --format=custom | zstd -19`):

```
/home/avion/backups/recipe_base/
├── daily/         YYYY-MM-DD.dump.zst    (kept 14 days)
├── weekly/        YYYY-MM-DD.dump.zst    (Sundays, kept 8 weeks)
├── monthly/       YYYY-MM-DD.dump.zst    (1st of month, kept 12 months)
└── off_mirror/daily/  YYYY-MM-DD.dump.zst (kept 14 days)
```

**Monthly automated restore verify** — `scripts/vps/04_restore_verify.sh` restores the latest daily dump into a throwaway `recipe_base_verify` database, compares per-table row counts to live, and exits non-zero on mismatch. Runs from cron on the 1st of every month.

**Health check** — `scripts/vps/05_health_check.sh` runs every 5 minutes (cron), hits `/health`, checks DB latency + disk usage on `/var/lib/postgresql`, posts failures to `HEALTHCHECK_WEBHOOK` if set.

**Restore procedure** — single-table, full DB, and disaster-recovery paths are documented in `docs/runbooks/backup_restore.md`. The cutover and rollback procedures are in `docs/runbooks/cutover.md` and `docs/runbooks/rollback.md`. Weekly perf review queries (top queries, dead tuples, unused indexes, pg_cron job status) live in `docs/runbooks/perf_review.sql`.

Offsite backup is deferred — see the migration plan for the discussion. If you decide to add it, the simplest path is to rsync `/home/avion/backups/recipe_base/` to an external host nightly.
