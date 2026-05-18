# Cutover runbook — Supabase → self-hosted Postgres

This is the minute-by-minute choreography for Phase 8 of the migration. It
assumes Phases 0–7 are GREEN: the data has been restored and verified, the new
build has been smoke-tested on port 3035, and the operator is ready to swing
DNS-of-the-process-tree from Supabase to `recipe_base`.

Target downtime: ≤ 5 minutes (Express usually flips in <30 s).

## Players, places, paths

| Name | Where | What |
|---|---|---|
| `recipe-api` | VPS, port 3034 | Express server |
| `recipe-worker` × 2 | VPS, PM2 | crawl workers (was 4) |
| `recipe-auditor` | VPS, PM2 | thin loop; most work is now in `pg_cron` |
| `recipe_base` | local Postgres 16 | target DB |
| `off_mirror` | local Postgres 16 | OFF mirror, unchanged |
| Supabase project `bxiqpogndbsxsbsczcle` | cloud | source of truth until T+0 |

Filesystem paths on the VPS (as the site user `wearemachina`):

```
/home/wearemachina/htdocs/recipe-base.wearemachina.com/recipe-api/
├── dist/                     ← current live (Supabase build)
├── dist-new/                 ← staging build (recipe_base build, port 3035)
├── .env                      ← current live env (SUPABASE_*)
├── .env.recipe-base          ← prepared new env (DATABASE_URL=…)
├── .env.supabase             ← (created at step T+0:4 as backup)
└── ecosystem.config.js
```

## T-24h — preparation checklist

Do these one day before. None are destructive.

- [ ] Branch `feat/self-host-postgres` is merged to a deployment-ready ref
      (either merged to `main` or tagged). All Agent A/B/C/D PRs in.
- [ ] Local `npm run build` is clean; `npm test` is green.
- [ ] On the VPS, prepare the staging build:
      ```bash
      cd /home/wearemachina/htdocs/recipe-base.wearemachina.com/recipe-api
      git fetch && git checkout feat/self-host-postgres
      npm ci
      npm run build
      mv dist dist-new       # park it next to the current live dist
      git checkout main      # restore the working tree to the live ref
      ```
- [ ] Restore the most-recent Supabase pg_dump into `recipe_base`:
      ```bash
      PGPASSWORD="$RECIPE_APP_PASSWORD" pg_restore --no-owner --no-acl \
          --dbname=recipe_base /var/backups/supabase_T0.dump
      ```
- [ ] Apply the self-host compat migration:
      ```bash
      cd /home/wearemachina/htdocs/recipe-base.wearemachina.com/recipe-api
      DATABASE_URL=postgresql://recipe_app:$PW@localhost:5432/recipe_base \
        npx ts-node src/scripts/migrate.ts
      ```
- [ ] Prepare the new env file (do NOT swap it yet):
      ```bash
      cp .env .env.recipe-base
      # Edit .env.recipe-base: remove SUPABASE_*, add DATABASE_URL=…
      ```
- [ ] Start the staging build on port 3035 and run the smoke suite:
      ```bash
      cd /home/wearemachina/htdocs/recipe-base.wearemachina.com/recipe-api
      PORT=3035 \
      DATABASE_URL=postgresql://recipe_app:$PW@localhost:5432/recipe_base \
        node dist-new/index.js &
      ```
      Then in another shell:
      ```bash
      curl -sS http://localhost:3035/health | jq .
      curl -sS "http://localhost:3035/recipes?limit=3" | jq '.data | length'
      curl -sS -H "x-api-key: $API_KEY" "http://localhost:3035/search?q=chicken" | jq '.results | length'
      ```
      All three must return 200 with sane payloads.
- [ ] Kill staging: `pkill -f 'dist-new/index.js'`.
- [ ] Verify backups landed for `recipe_base` (Phase 9 cron may not have run yet
      — kick it once manually: `sudo -u postgres /usr/local/bin/recipe-backup-nightly.sh`).
- [ ] Notify whoever cares (Slack, status page) that a 5-minute maintenance
      window is coming.

If anything above fails: **stop, fix, re-run the day**. The cutover only
happens after this checklist is clean.

## T-1h — final pre-cutover snapshot

Capture an immutable record of Supabase exactly as it stands one hour before
the switch:

```bash
mkdir -p /var/backups/cutover
PGPASSWORD="$SUPABASE_DB_PW" pg_dump \
    --format=custom --no-owner --no-acl \
    --file="/var/backups/cutover/supabase_T-1h.dump" \
    "postgresql://postgres.bxiqpogndbsxsbsczcle@aws-0-us-west-1.pooler.supabase.com:5432/postgres"

ls -lh /var/backups/cutover/
```

Record the wall-clock timestamp on the dump completion — this is the `T_minus_1h`
value used by the delta-sync at T+0:2 below.

```bash
date --iso-8601=seconds > /var/backups/cutover/T_minus_1h.txt
cat /var/backups/cutover/T_minus_1h.txt
```

## T+0 — the 5-minute window

Run these steps in order. Each is **idempotent** if it succeeds; if it fails,
read the matching contingency below before retrying.

### Step 1 — stop the workers

```bash
pm2 stop recipe-worker recipe-auditor
```

This stops new DB writes from background processes but lets the API keep
serving reads. Verify:

```bash
pm2 status | grep -E 'recipe-(worker|auditor|api)'
# recipe-api: online, recipe-worker: stopped, recipe-auditor: stopped
```

### Step 2 — delta-sync rows changed since T-1h

Take a second Supabase snapshot, restricted to rows updated since the T-1h
mark, and replay into `recipe_base`. The simplest reliable form: a fresh
full dump and selective restore for the hot tables (`crawl_jobs`, `recipes`,
`recipes_qa`):

```bash
PGPASSWORD="$SUPABASE_DB_PW" pg_dump \
    --format=custom --no-owner --no-acl --data-only \
    --table=public.crawl_jobs --table=public.recipes --table=public.recipes_qa \
    --where="updated_at > '$(cat /var/backups/cutover/T_minus_1h.txt)'" \
    --file="/var/backups/cutover/supabase_delta.dump" \
    "postgresql://postgres.bxiqpogndbsxsbsczcle@aws-0-us-west-1.pooler.supabase.com:5432/postgres"

# Replay into recipe_base.
PGPASSWORD="$RECIPE_APP_PASSWORD" pg_restore \
    --no-owner --no-acl --data-only \
    --on-conflict-do-nothing \
    --dbname=recipe_base \
    /var/backups/cutover/supabase_delta.dump
```

(`--on-conflict-do-nothing` requires pg_restore from PG 16; if not available,
script a small `psql` `UPSERT` loop — see contingency at the bottom.)

Verify the row deltas: row counts should now match between source and target
for those three tables. Skip the full SHA-256 verify here; it was run in
Phase 4. The delta is small.

### Step 3 — swap the build directory

```bash
cd /home/wearemachina/htdocs/recipe-base.wearemachina.com/recipe-api
mv dist dist-old           # park the Supabase build
mv dist-new dist           # promote the recipe_base build
```

If `mv dist dist-old` errors out because `dist-old` exists from a previous
attempt, `rm -rf dist-old.older && mv dist-old dist-old.older && mv dist dist-old`.

### Step 4 — atomic env swap

```bash
cp .env .env.supabase           # backup current
cp .env.recipe-base .env        # promote new
```

Verify the new file has `DATABASE_URL=postgresql://recipe_app:…@localhost:5432/recipe_base`
and **no** `SUPABASE_*` lines:

```bash
grep -E '^(DATABASE_URL|SUPABASE_)' .env
# Expected output: only DATABASE_URL=…
```

### Step 5 — restart the PM2 stack

```bash
pm2 restart recipe-api recipe-worker recipe-auditor
pm2 logs --lines 50 --timestamp
```

Watch for: `Database connection established`, `Listening on port 3034`,
`LISTEN crawl_jobs_new ready`. Bail to RED path if you see repeated connection
errors or `relation "…" does not exist`.

## T+0 to T+5 min — smoke gate

Run these five curl calls. Every one must pass. The expected payload shape is
roughly what's shown — the byte-exact response will vary, but the keys must be
present and the status must be 200.

### 1. Health

```bash
curl -sS -w '\nHTTP %{http_code}\n' http://localhost:3034/health
```
Expected:
```
{"status":"ok","db_latency_ms":<int>,"pool":{"total":<n>,"idle":<n>,"waiting":<n>}}
HTTP 200
```

### 2. Recipes listing

```bash
curl -sS -H "x-api-key: $API_KEY" "http://localhost:3034/recipes?limit=5" | jq '.data | length'
```
Expected: `5`.

### 3. Hybrid search

```bash
curl -sS -H "x-api-key: $API_KEY" "http://localhost:3034/search?q=chicken+stew&limit=3" | jq '.results | length'
```
Expected: `3` (or whatever your top-N is for that query — non-zero).

### 4. Nutrition

```bash
curl -sS -H "x-api-key: $API_KEY" \
    -H "content-type: application/json" \
    -d '{"ingredients":["1 cup rice","100g chicken breast","1 tbsp olive oil"]}' \
    http://localhost:3034/nutrition/analyze | jq '.totals.calories'
```
Expected: a positive number (typically 400-700).

### 5. LISTEN/NOTIFY worker latency

This is the critical end-to-end check that the new architecture actually works.

```bash
JOB_ID=$(curl -sS -H "x-api-key: $API_KEY" \
    -H "content-type: application/json" \
    -d '{"url":"https://www.bbcgoodfood.com/recipes/chicken-stew"}' \
    http://localhost:3034/crawl | jq -r '.id')
echo "job id: $JOB_ID"

# Poll the status; should flip from pending to processing within ~1s.
for i in $(seq 1 10); do
    STATUS=$(PGPASSWORD="$RECIPE_READONLY_PASSWORD" psql -U recipe_readonly \
        -h localhost -d recipe_base -tAc "SELECT status FROM crawl_jobs WHERE id='$JOB_ID';")
    echo "t=${i}s status=$STATUS"
    [[ "$STATUS" == "processing" || "$STATUS" == "complete" ]] && break
    sleep 1
done
```

Expected: status reaches `processing` (or `complete`) within 2 seconds. If it
sits at `pending` for >10s, the LISTEN/NOTIFY trigger isn't firing — go RED.

## GREEN path — declare success

If all five smoke calls pass within 5 minutes:

1. Update the status page / Slack: "cutover complete, on `recipe_base`."
2. Leave the system alone for ~10 min watching `pm2 logs` for unhandled errors.
3. Proceed to Phase 9 (backups) and Phase 10 (observability).
4. Decommission Supabase per Phase 11 — but not until 24 hours have passed
   with clean metrics.

## RED path — abort and rollback

If any of the smoke calls fail in a way you can't diagnose in under 60 seconds,
**stop trying to fix forward**. Go to `rollback.md` and execute the fast
rollback (target: back on Supabase in < 30 seconds).

Common red-path triggers:

- Step 5: `pm2 restart` shows `connection refused` to Postgres → wrong host /
  port / password in `.env`. Fix and restart, or roll back.
- Smoke 1: `/health` returns 500 → check `pm2 logs recipe-api --err`.
- Smoke 5: job stays at `pending` for >10 s → LISTEN/NOTIFY broken; roll back
  and investigate.

## Contingency tree

### What if `pg_dump` (T-1h snapshot) fails?

- Connection error: check the Supabase pooler is up
  (`curl https://status.supabase.com/`). If pooler is down but direct is up,
  swap the connection string to the direct-database port (`db.bxiq…supabase.co:5432`).
- Auth error: regenerate the Supabase DB password in the dashboard and re-run.
- Timeout: increase `statement_timeout` server-side is not possible; instead,
  split the dump per-table with `--table=` flags so each is short.

### What if `pg_restore` (T-1h or delta) fails on a single row?

- The dump is `--format=custom`, so it's resumable. Re-run pg_restore with
  `--clean --if-exists` if a partial restore is corrupted, or with
  `--exit-on-error=off` to skip the bad row and inspect the log afterwards.
- For data-only deltas, the cleanest path is to run the dump-then-restore
  again — Supabase rows do not change retroactively, so re-running gets the
  same byte-exact data.

### What if delta `--on-conflict-do-nothing` isn't supported?

Fall back to a manual UPSERT loop. Example for `crawl_jobs`:

```bash
PGPASSWORD="$SUPABASE_DB_PW" psql \
    "postgresql://postgres.bxiqpogndbsxsbsczcle@…/postgres" \
    -c "COPY (SELECT * FROM crawl_jobs WHERE updated_at > '$T_MINUS_1H') TO STDOUT WITH CSV HEADER" \
    > /tmp/delta_crawl_jobs.csv

PGPASSWORD="$RECIPE_APP_PASSWORD" psql -U recipe_app -d recipe_base <<'SQL'
CREATE TEMP TABLE staging_crawl_jobs (LIKE crawl_jobs INCLUDING ALL);
\copy staging_crawl_jobs FROM '/tmp/delta_crawl_jobs.csv' WITH CSV HEADER
INSERT INTO crawl_jobs SELECT * FROM staging_crawl_jobs
    ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at,
        next_retry_at = EXCLUDED.next_retry_at;
SQL
```

### What if `vector` extension didn't load on restart?

Symptom: pg_restore fails with `type "vector" does not exist`.

Fix:

```bash
sudo -u postgres psql -d recipe_base -c 'CREATE EXTENSION IF NOT EXISTS vector;'
sudo -u postgres psql -d recipe_base -c 'CREATE EXTENSION IF NOT EXISTS pg_cron;'
```

If `pg_cron` errors with `pg_cron must be loaded via shared_preload_libraries`,
the postgresql.conf edit didn't take. Re-run
`scripts/vps/01_install_extensions.sh` and verify with
`SHOW shared_preload_libraries;`.

### What if PM2 won't start the new build?

```bash
pm2 logs recipe-api --err --lines 100
```

Common causes:
- `DATABASE_URL` malformed → `Error: invalid connection string`.
- Missing extension function the app calls → check the
  `20260517000000_self_host_compat.sql` migration ran successfully.
- Wrong file mode on `dist/` after `mv` → `chown -R wearemachina:wearemachina dist`.

If the cause isn't obvious within 60 s, **roll back** (`rollback.md`),
investigate offline, schedule a new cutover window.

### What if the smoke gate is flaky (3-of-5 pass)?

This is the worst case — not clearly GREEN, not clearly RED. Default action:
**roll back**. A flaky cutover means something is subtly wrong; better to
debug from the Supabase side than chase intermittent failures on production.

## Post-cutover

After T+30 minutes of clean operation:

- [ ] Verify `cron.job` is running: `SELECT jobname, schedule, last_run, last_status FROM cron.job;`
- [ ] Verify backups: `ls -lh /home/avion/backups/recipe_base/daily/`
- [ ] Verify health check log: `tail -20 /var/log/recipe-health.log`
- [ ] Note the cutover timestamp in `docs/runbooks/memory_baseline.md` (for
      capacity trend tracking).

After T+24h of clean operation:

- Proceed to Phase 11 (decommission Supabase). See plan
  `~/.claude/plans/bubbly-doodling-castle.md` Phase 11 for the steps.
