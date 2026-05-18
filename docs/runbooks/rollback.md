# Rollback runbook

Two paths, depending on how much time has elapsed since cutover (Phase 8).

| Path | When | Target time | Data loss risk |
|---|---|---|---|
| **Fast** | < 5 min after the env swap (Supabase is still authoritative; the app made effectively no recipe_base writes) | < 30 s | none |
| **Slow** | After 24h of recipe_base being the source of truth | hours | depends on Supabase project state |

Pick once. Don't try the fast path after a worker has actually processed jobs
against `recipe_base` — you would lose those new rows.

---

## Fast rollback (< 5 minutes after cutover)

You are here because the smoke gate in `cutover.md` failed and the system has
been running on `recipe_base` for under 5 minutes. Supabase is still up,
nothing was deleted on it, and the recipe_base writes (if any) are limited to
a handful of crawl jobs that can be re-submitted.

### Steps

1. `cd /home/wearemachina/htdocs/recipe-base.wearemachina.com/recipe-api`
2. Swap the build directory back:
   ```bash
   mv dist dist-new-failed
   mv dist-old dist
   ```
3. Restore the Supabase env file:
   ```bash
   cp .env .env.recipe-base-failed   # keep the broken one for diagnosis
   cp .env.supabase .env
   ```
4. Restart everything:
   ```bash
   pm2 restart recipe-api recipe-worker recipe-auditor
   ```
5. Wait ~10 s, then verify:
   ```bash
   curl -sS http://localhost:3034/health
   curl -sS -H "x-api-key: $API_KEY" "http://localhost:3034/recipes?limit=1"
   ```

### Expected state after rollback

- API serving on port 3034 against Supabase.
- `recipe_base` is left as-is — do **not** drop it; it's now your candidate
  database for the next cutover attempt.
- `dist-new-failed/` and `.env.recipe-base-failed` preserved for postmortem.

### What to do next

1. Read `pm2 logs recipe-api --err --lines 200` carefully.
2. Read `pm2 logs recipe-worker --err --lines 200`.
3. Whatever was wrong, fix it on the branch. Rebuild. Re-run Phase 6
   (staging) before scheduling another cutover.

If the fast rollback itself fails (PM2 won't bring Express back up against
Supabase), check:
- Is `.env.supabase` actually populated? `grep SUPABASE .env` should show three lines.
- Did anyone rotate the Supabase service role key in the dashboard between
  T-1h and now? If so, fetch the current key, put it in `.env`, restart.
- Worst case: roll the `dist/` directory all the way back to a known-good
  git tag and `npm ci && npm run build` from scratch. Slow, but reliable.

---

## Slow rollback (after 24h on recipe_base)

You are here because production has been on `recipe_base` for hours-to-days
and you've decided to revert to Supabase. This is a **last resort**: data has
diverged. Crawl jobs, recipe edits, new API keys — all of it is in
`recipe_base` but not in Supabase.

**Acknowledge before you start:** this is a multi-hour operation. If the
Supabase project was deleted as part of Phase 11, you'll first need to
recreate it, which adds another hour minimum.

### Prerequisites

- The Supabase project still exists (paused is OK). If it was deleted, see
  "Supabase project is gone" at the bottom.
- You have the original `.env.supabase` somewhere (we kept it on the VPS at
  cutover time — check `/home/wearemachina/htdocs/.../recipe-api/.env.supabase`).
- You have `pg_dump` / `pg_restore` / `zstd` on the VPS.

### Steps

1. Take a fresh dump of `recipe_base`:
   ```bash
   sudo -u postgres pg_dump --format=custom --no-owner --no-acl \
       --file=/var/backups/recipe_base_pre_rollback.dump recipe_base
   ```
   This is your authoritative copy of "current production." Don't lose it.

2. If the Supabase project is paused, unpause it from the dashboard and wait
   for it to come back. Verify with `psql` from the VPS:
   ```bash
   PGPASSWORD="$SUPABASE_DB_PW" psql \
       "postgresql://postgres.bxiq…@aws-0-us-west-1.pooler.supabase.com:5432/postgres" \
       -c "SELECT 1"
   ```

3. (Optional but recommended) Take a snapshot of Supabase as it is right now,
   pre-restore, in case the restore goes wrong:
   ```bash
   PGPASSWORD="$SUPABASE_DB_PW" pg_dump --format=custom --no-owner --no-acl \
       --file=/var/backups/supabase_pre_restore.dump \
       "postgresql://postgres.bxiq…@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
   ```

4. Truncate Supabase's app tables. Do NOT drop the database — Supabase manages
   the auth / storage schemas. Only clear the public.* tables we own:
   ```bash
   PGPASSWORD="$SUPABASE_DB_PW" psql \
       "postgresql://postgres.bxiq…@aws-0-us-west-1.pooler.supabase.com:5432/postgres" \
       -c "DO \$\$ DECLARE t text; BEGIN
           FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
             EXECUTE 'TRUNCATE public.' || quote_ident(t) || ' CASCADE';
           END LOOP;
       END \$\$;"
   ```

5. Restore the recipe_base dump into Supabase. Data-only — the schema in
   Supabase still exists, you just emptied the rows.
   ```bash
   PGPASSWORD="$SUPABASE_DB_PW" pg_restore \
       --no-owner --no-acl --data-only --disable-triggers \
       --dbname="postgresql://postgres.bxiq…@aws-0-us-west-1.pooler.supabase.com:5432/postgres" \
       /var/backups/recipe_base_pre_rollback.dump
   ```
   This will take a while (full table data over the network — 10s of minutes).

6. Re-enable RLS on the 7 tables that had it before the migration. The
   `20260517000000_self_host_compat.sql` migration recorded which they were.
   The simplest path is to re-apply the original RLS migrations on the
   Supabase project via the Supabase CLI:
   ```bash
   cd /home/francisco/projects/recipe-search
   supabase db push    # if the supabase project linkage is still configured
   ```
   Manually if the CLI is unhappy: copy the RLS-touching migrations
   (`20251225000000_fix_security_warnings.sql`, `20251225000002_add_api_keys.sql`,
   `20251225000003_add_email_to_keys.sql`, etc.) into a single SQL block
   and `psql` them in.

7. Swap the env file back:
   ```bash
   cd /home/wearemachina/htdocs/recipe-base.wearemachina.com/recipe-api
   cp .env .env.recipe-base-final
   cp .env.supabase .env
   ```

8. Restart PM2:
   ```bash
   pm2 restart all
   pm2 logs --lines 50 --timestamp
   ```

9. Re-run the smoke gate from `cutover.md` (the same 5 curl calls — they're
   provider-agnostic).

### Post-slow-rollback cleanup

- Leave `recipe_base` running but mark it read-only:
  `ALTER DATABASE recipe_base SET default_transaction_read_only = on;`.
  Keep it for at least a week as your "what we had on the VPS" archive.
- The pg_cron jobs and LISTEN/NOTIFY triggers are local to `recipe_base` —
  they don't need cleanup. They just stop being used.
- Disable the cron entries in `/etc/cron.d/recipe-backup` for `recipe_base`
  (the dumps will still happen and consume disk; comment them out).

### Supabase project is gone

If the Supabase project was deleted as part of Phase 11:

1. Create a new Supabase project. Note the new ref (e.g. `xxxxx.supabase.co`).
2. Re-run all 29 migrations in `supabase/migrations/` against it:
   ```bash
   supabase link --project-ref <new_ref>
   supabase db push
   ```
3. Capture the new DB password from the dashboard, build a new `.env.supabase`
   with the new URL / keys.
4. Then run steps 1, 4, 5, 7-9 above (you no longer need step 2 / 3 / 6).
5. Add ~30 minutes wall-clock for the new project to provision.

This is painful enough that **the strong recommendation is to not delete the
Supabase project until 30+ days post-cutover**, regardless of what Phase 11
of the plan says. Pause it, but keep the data accessible.
