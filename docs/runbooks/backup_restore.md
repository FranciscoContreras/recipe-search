# Backup & restore runbook

How to inspect, restore, and verify the `recipe_base` (and `off_mirror`)
backups produced by `scripts/vps/03_backup_nightly.sh`.

## Where the backups live

```
/var/backups/recipe_base/
├── daily/         YYYY-MM-DD.dump.zst       (kept 14 days)
├── weekly/        YYYY-MM-DD.dump.zst       (kept 8 weeks; only Sundays)
├── monthly/       YYYY-MM-DD.dump.zst       (kept 12 months; only 1st of month)
├── off_mirror/
│   └── daily/     YYYY-MM-DD.dump.zst       (kept 14 days)
└── last-failure.txt    (only present if the last run failed)
```

Format: PostgreSQL custom-format dumps (`pg_dump --format=custom`),
zstd-compressed (`zstd -19`). Restored with `pg_restore`, after decompressing
with `zstd -d`.

Permissions: directory is `0700`, owned by `postgres` (writer) with `avion`
group access for off-host sync if you choose to add it later. The dumps are
plain files; nothing CLI-side prevents you copying them off the VPS — they're
just large.

## Quick inventory

```bash
ls -lh /var/backups/recipe_base/daily/   | tail -20
ls -lh /var/backups/recipe_base/weekly/  | tail -20
ls -lh /var/backups/recipe_base/monthly/ | tail -20

# Most-recent successful run summary:
grep '\[recipe-backup\] OK' /var/log/recipe-backup.log | tail -5

# Most-recent failure (if any):
cat /var/backups/recipe_base/last-failure.txt 2>/dev/null \
    || echo "no recent failure"
```

## Single-table restore

Most common: a bad migration or accidental DELETE on one table. Restore just
that table into the live DB (or into a temp DB to inspect first).

### Inspect a dump's contents without restoring

```bash
DUMP=/var/backups/recipe_base/daily/2026-05-17.dump.zst
zstd -dc "$DUMP" | pg_restore --list | head -50
```

This prints the TOC (table of contents). Each line is `<id>; <oid> <oid> <type>
<schema> <object> <owner>`. You can filter to a table with `pg_restore --list
... | grep -E 'TABLE DATA  public  recipes$'`.

### Restore one table into the live DB

```bash
DUMP=/var/backups/recipe_base/daily/2026-05-17.dump.zst

# 1. Get a fresh row count to know what you're replacing.
sudo -u postgres psql -d recipe_base -c "SELECT count(*) FROM recipes;"

# 2. Truncate the target (cascade if there are FKs you trust).
sudo -u postgres psql -d recipe_base -c "TRUNCATE recipes CASCADE;"

# 3. Restore just that table's data.
zstd -dc "$DUMP" | sudo -u postgres pg_restore \
    --data-only --table=recipes --no-owner --no-acl \
    --disable-triggers --dbname=recipe_base
```

`--disable-triggers` is important — it skips the LISTEN/NOTIFY trigger and any
audit triggers during bulk load. Without it, every row you restore would emit
a NOTIFY and wake the worker pool.

### Safer single-table restore — into a temp DB first

If you want to inspect before swapping:

```bash
sudo -u postgres createdb recipes_restore_test
zstd -dc "$DUMP" | sudo -u postgres pg_restore \
    --table=recipes --no-owner --no-acl --dbname=recipes_restore_test

sudo -u postgres psql -d recipes_restore_test \
    -c "SELECT id, title, created_at FROM recipes ORDER BY created_at DESC LIMIT 10;"
```

Then `dblink` or `COPY … TO STDOUT | COPY … FROM STDIN` between the two when
you're satisfied. When done:

```bash
sudo -u postgres dropdb recipes_restore_test
```

## Full DB restore

Use this when `recipe_base` is corrupt or you need to roll back to a known
good day.

### Restore over the existing recipe_base (destructive)

```bash
DUMP=/var/backups/recipe_base/daily/2026-05-17.dump.zst

# 1. Stop the app to prevent writes.
pm2 stop recipe-api recipe-worker recipe-auditor

# 2. Drop and recreate the database.
sudo -u postgres psql -c "DROP DATABASE IF EXISTS recipe_base;"
sudo -u postgres psql -c "CREATE DATABASE recipe_base;"
sudo -u postgres psql -c "ALTER DATABASE recipe_base OWNER TO recipe_owner;"

# 3. Re-enable extensions BEFORE restoring (the dump assumes vector/pg_cron exist).
sudo -u postgres psql -d recipe_base <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS vector;
SQL

# 4. Re-grant defaults (otherwise the restore creates objects owned by postgres
# and recipe_app can't access them).
sudo -u postgres psql -d recipe_base <<'SQL'
GRANT CONNECT ON DATABASE recipe_base TO recipe_app, recipe_readonly;
GRANT USAGE  ON SCHEMA public TO recipe_app, recipe_readonly;
GRANT CREATE ON SCHEMA public TO recipe_owner;
SQL

# 5. Restore.
zstd -dc "$DUMP" | sudo -u postgres pg_restore \
    --no-owner --no-acl --exit-on-error --dbname=recipe_base

# 6. Re-grant (the restore created tables; they need recipe_app access).
sudo -u postgres psql -d recipe_base <<'SQL'
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO recipe_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO recipe_app;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA public TO recipe_app;
GRANT SELECT                         ON ALL TABLES    IN SCHEMA public TO recipe_readonly;
SQL

# 7. Bring the app back.
pm2 restart recipe-api recipe-worker recipe-auditor
pm2 logs --lines 50
```

### Restore into a side-channel database (non-destructive)

If you want to keep `recipe_base` running and recover a snapshot for
investigation:

```bash
sudo -u postgres createdb recipe_base_snapshot_2026_05_17
zstd -dc "$DUMP" | sudo -u postgres pg_restore \
    --no-owner --no-acl --dbname=recipe_base_snapshot_2026_05_17
```

Then query it directly, or `dblink` between the two for surgical row recovery:

```sql
-- e.g. recover 12 deleted recipes
INSERT INTO recipe_base.public.recipes
SELECT * FROM dblink(
    'dbname=recipe_base_snapshot_2026_05_17',
    'SELECT * FROM recipes WHERE id IN (…)'
) AS t(id uuid, title text, …);
```

When done: `sudo -u postgres dropdb recipe_base_snapshot_2026_05_17`.

## Verifying a restore

After any restore (single-table or full), confirm what you have makes sense.

### Row counts vs. live

```bash
sudo -u postgres psql -d recipe_base <<'SQL'
SELECT 'recipes'                   AS tbl, count(*) FROM recipes
UNION ALL SELECT 'crawl_jobs',                count(*) FROM crawl_jobs
UNION ALL SELECT 'ingredient_cache',          count(*) FROM ingredient_cache
UNION ALL SELECT 'cnf_foods',                 count(*) FROM cnf_foods
UNION ALL SELECT 'api_keys',                  count(*) FROM api_keys
ORDER BY tbl;
SQL
```

Compare against the row counts you expect (from Phase 2 of the migration:
recipes 23,559 / crawl_jobs 19,080 / ingredient_cache 459 / cnf_foods 5,690
/ api_keys 6; these change over time, so use the live numbers from before the
incident as the reference).

### Snapshot of pg_stat_statements

If the restore was full-DB, the planner cache and pg_stat_statements are
empty. Don't panic — both refill as queries run. To get a baseline:

```bash
sudo -u postgres psql -d recipe_base -c "
    SELECT pg_stat_statements_reset();
"
# Run normal traffic for ~10 min, then:
sudo -u postgres psql -d recipe_base -c "
    SELECT calls, mean_exec_time, query
    FROM pg_stat_statements
    ORDER BY total_exec_time DESC
    LIMIT 10;
"
```

If the top queries don't match what you saw pre-incident, the workload has
shifted — investigate, but don't roll the restore back unless something is
materially wrong.

### LISTEN/NOTIFY smoke test

After any full restore, verify the trigger is still firing:

```bash
# Terminal 1
sudo -u postgres psql -d recipe_base -c "LISTEN crawl_jobs_new;" -c "SELECT pg_sleep(60);" &
LISTEN_PID=$!

# Terminal 2
sudo -u postgres psql -d recipe_base -c "
    INSERT INTO crawl_jobs (url, status, created_at, updated_at)
    VALUES ('https://test.local/restore-check', 'pending', now(), now());
"

# Terminal 1 should print a NOTIFY line within ~100ms.
wait $LISTEN_PID 2>/dev/null
```

### `pg_cron` schedules survived

```bash
sudo -u postgres psql -d recipe_base \
    -c "SELECT jobname, schedule, command FROM cron.job;"
```

Expected: at minimum the `refresh-recipe-stats` and `audit-batch` jobs from
the `20260517000000_self_host_compat.sql` migration. If they're missing, re-run
that migration (`npx ts-node src/scripts/migrate.ts`).

## Disaster: VPS is dead

Two recovery paths.

### 1. Backups directory is reachable from another host

If the disk on `/home/avion/backups` is intact but the OS is broken — pull the
dumps off via the recovery console, dd image, or just `scp`:

```bash
# From a recovery shell / rescue boot:
scp /var/backups/recipe_base/daily/<latest>.dump.zst \
    user@another-host:/var/backups/

# On the new host, install Postgres 16 + extensions:
sudo apt install -y postgresql-16 postgresql-16-cron postgresql-16-pgvector zstd
# … then run scripts/vps/01_install_extensions.sh and 02_create_db_and_roles.sh
# (commit them as part of the repo, so they're available even without the old VPS)
# … then the full-restore procedure above.
```

### 2. Backups directory unreachable

Fall back to CloudPanel's own DB exports. CloudPanel keeps the last several
`clpctl db:export` dumps under `/home/<site-user>/backups/` (path varies by
CloudPanel version — search for `*.sql.gz`).

```bash
# On a fresh VPS with CloudPanel restored:
sudo find / -name '*.sql.gz' -path '*backups*' 2>/dev/null
```

These are SQL-format (not custom-format), so restore with:

```bash
gunzip -c /path/to/recipe_base.sql.gz | sudo -u postgres psql -d recipe_base
```

The CloudPanel dumps include schema + data and assume an empty DB. If you
want extensions installed first, run Phase 1 + 2 of the migration before the
restore.

### 3. Both are gone

You will be reconstructing from primary sources:
- **Supabase**: if the project still exists / hasn't been deleted, see
  `rollback.md` Slow rollback for how to pull from it. This is why the plan
  recommends keeping the Supabase project paused (not deleted) for ≥ 30 days.
- **OFF mirror**: `sync_off.ts full` re-imports from the Open Food Facts
  download server. Takes 10-30 min.
- **Recipes**: re-crawled from URLs via the `/crawl` endpoint. The `crawl_jobs`
  history is lost; the recipes will reappear from scratch (slow — hours to days
  depending on volume).
- **`ingredient_cache`, `cnf_foods`, etc.**: re-populated from API calls.
- **API keys**: regenerate and notify users — these can't be recovered.

This is the worst case and the reason for offsite backups, which are listed in
the plan as a deferred follow-up. Decide whether to enable them per
`docs/runbooks/perf_review.sql` review cadence.

## Schedule for testing this

- **Monthly**: automated restore-verify via
  `scripts/vps/04_restore_verify.sh`. This catches "the dumps exist but don't
  restore" failures before you need them.
- **Quarterly (manual)**: pretend the VPS is dead and do a dry-run of the
  CloudPanel recovery path from a fresh VM or container. 30 minutes of
  exercise pays for itself the first time it matters.
