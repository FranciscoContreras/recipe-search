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

**Generating an API key without env vars** — the local `.env` has placeholder `...` values for Supabase credentials. Use the Supabase CLI session (which stays authenticated) to push keys directly:

```bash
# From recipe-api/
./src/scripts/generate_key_internal.sh "owner-name" "owner@email.com"
```

This generates a key, pushes it via a temporary migration using the authenticated CLI session, then removes the migration file from source. The `generate_key.ts` script requires `SUPABASE_SERVICE_ROLE_KEY` in `.env` — not available locally.

**Production audit** (requires authenticated CLI session):
```bash
API_KEY=sk_... npx ts-node src/scripts/production_audit.ts
```

```bash
npm test              # Run Jest unit tests (60 tests across 5 suites)
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

Tests live in `src/__tests__/`. The supabase client is mocked in tests that import `NutritionEngine` — see `units.test.ts` for the pattern.

## Architecture

The project is a Node.js/TypeScript Express API deployed on a VPS at `recipe-base.wearemachina.com`. There is no frontend framework — the UI is static HTML served from `public/`.

### Three PM2 processes (defined in `ecosystem.config.js`)

| Process | Entry | Purpose |
|---|---|---|
| `recipe-api` | `dist/index.js` | Express HTTP server, port 3034 |
| `recipe-worker` | `dist/worker.ts` | 4 parallel crawl job consumers |
| `recipe-auditor` | `dist/auditor.ts` | Background QA + nutrition enrichment |

### Request flow

All routes are defined in `src/index.ts`. The `apiKeyAuth` middleware (mounted with `app.use`) guards every route defined **after** it. Routes defined before the middleware are public.

**Public:** `/`, `/health`, `/auth/request-key`, `/api-docs`, static files, `/recipe/:id` (SSR), `/robots.txt`, `/sitemap.xml`

**Protected (require `x-api-key` header):** `/recipes`, `/search`, `/nutrition/analyze`, `/crawl`, `/jobs`

### Auth system (`src/middleware/auth.ts`)

API keys are stored SHA-256-hashed in the `api_keys` Supabase table. The middleware uses the **service role key** (not the anon key) to bypass RLS. Validated keys are cached in-process for 1 minute to reduce DB load. Key generation and email delivery are handled by `src/controllers/authController.ts` + `src/services/email.ts` (Resend).

### Crawl pipeline

1. Client POSTs a URL to `/crawl` → inserts a `crawl_jobs` row with `status: 'pending'`
2. `worker.ts` polls the table continuously with exponential backoff (5s→60s) + random jitter to prevent worker lockstep
3. Worker claims a job by updating status to `'processing'`, then runs `RecipeCrawlerService` (Playwright + Crawlee)
4. Failed jobs enter `status: 'cooling_down'` with a `next_retry_at` timestamp for retry logic

### Nutrition engine (`src/services/nutritionEngine.ts`)

`NutritionEngine.analyze(ingredients[])` parses natural-language ingredient strings using the `parse-ingredient` library, converts volumetric units to grams via an internal density table (`DENSITY_TABLE`), then queries USDA and FatSecret APIs for per-ingredient macros. On `GET /recipes/:id`, if a recipe has no stored nutrition, enrichment is triggered fire-and-forget in the background (JIT enrichment).

### Database

Supabase (PostgreSQL) with migrations in `supabase/migrations/`. Two clients are used:
- `src/supabaseClient.ts` — anon key, used by the API for recipe/job data
- Auth middleware creates its own client with the service role key for `api_keys`

Key RPC functions:
- `search_recipes_hybrid` — combines pgvector semantic search with full-text search
- `update_recipe_nutritions` — batch upsert for nutrition data

### Deployment

GitHub Actions (`.github/workflows/deploy.yml`) triggers on push to `main`: builds TypeScript, rsyncs to the VPS (excluding `node_modules`, `.env`), then runs `pm2 reload ecosystem.config.js` as the site user.

### Environment variables

Required in `recipe-api/.env`:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `FATSECRET_CLIENT_ID`, `FATSECRET_CLIENT_SECRET` — IP-whitelisted; register production server's IP in FatSecret developer dashboard
- `USDA_API_KEY` — register a **separate key for local dev** at https://fdc.nal.usda.gov/api-key-signup so production quota isn't shared
- `API_NINJAS_KEY` — **not used in production chain** (free tier blocks calories + protein — premium required). Key stored but service returns null unless upgraded.
- `RESEND_API_KEY`
- `PORT` (defaults to 3000; production uses 3034 via PM2)

### Nutrition source chain (in lookup order)

```
Cache (Supabase ingredient_cache v11:*)
  → USDA FoodData Central  — raw ingredients, per-100g, unlimited, no IP restriction
  → Open Food Facts         — packaged/branded goods, 4M+ products, no key required
  → FatSecret               — production only (IP whitelisted), 2.3M foods
```

Packaged ingredient detection (keywords: `can`, `tin`, `jar`, `bottle`, etc.) routes OFF before USDA.

New endpoint: `POST /nutrition/barcode` — looks up any EAN-13/UPC-A barcode via Open Food Facts, returns per-100g + scaled-to-amount nutrition + Nutri-Score grade.

### Open Food Facts local mirror (`off_products` table)

Instead of hitting the OFF API on every request (prone to 503s), the full product database is mirrored locally in Supabase:

```bash
# First-time import (~900 MB download, 10-30 min, populates ~1-2M products with nutrition)
SUPABASE_URL=<real> SUPABASE_SERVICE_ROLE_KEY=<real> npx ts-node src/scripts/sync_off.ts full

# Weekly delta sync (applies last 7 days of changes, run via cron)
SUPABASE_URL=<real> SUPABASE_SERVICE_ROLE_KEY=<real> npx ts-node src/scripts/sync_off.ts delta

# Or last N days
npx ts-node src/scripts/sync_off.ts delta --days 14
```

After `full` import: text search and barcode lookups hit the local `off_products` table (sub-ms, no 503s). Live OFF API is only called for products not yet in the mirror.

**Storage reality** — current Supabase usage is ~172 MB (free tier = 500 MB). OFF full import (~1.4 GB) exceeds free tier. Two options:
- **Supabase Pro ($25/mo)** — includes 8 GB, everything stays in one place
- **VPS PostgreSQL** (preferred for OFF) — set `OFF_DB_URL=postgresql://...@localhost:5432/off_mirror` in `.env`. The app automatically uses VPS for OFF queries (local socket, <1ms) and falls back to Supabase, then the live API. VPS disk is large enough; no additional cost.

VPS setup (run once on the server):
```bash
createdb off_mirror
psql off_mirror < supabase/migrations/20260511000001_off_products_table.sql
psql off_mirror < supabase/migrations/20260511000002_off_products_expand_schema.sql
OFF_DB_URL=postgresql://user:pass@localhost:5432/off_mirror \
  npx ts-node src/scripts/sync_off.ts full
```
