-- =====================================================================
-- perf_review.sql — Weekly Postgres health-and-performance review.
--
-- Run as: recipe_readonly (most queries) or postgres (for cron.* views).
--
-- Usage:
--   PGPASSWORD=$RECIPE_READONLY_PASSWORD psql -h localhost \
--     -U recipe_readonly -d recipe_base -f docs/runbooks/perf_review.sql
--
-- Block-by-block. Each section has a header comment explaining what to look
-- for and what action a bad result implies.
-- =====================================================================

\pset pager off
\pset format aligned
\timing on

-- ---------------------------------------------------------------------
-- 1. Top 20 queries by TOTAL execution time
-- ---------------------------------------------------------------------
-- These are the queries hurting the system most overall (sum of work, not
-- average per call). Anything new and unfamiliar in the top 5 is worth
-- understanding. The Supabase-era patterns (PostgREST-style
-- "set_config('search_path', …)" and 'SELECT recipes.*') should be GONE
-- post-migration — if they appear, the rewrite missed a call site.
\echo '=== TOP 20 BY TOTAL EXEC TIME ==='
SELECT
    round(total_exec_time::numeric, 1) AS total_ms,
    calls,
    round((total_exec_time / calls)::numeric, 2) AS mean_ms,
    round((rows::numeric / NULLIF(calls, 0))::numeric, 1) AS avg_rows,
    left(regexp_replace(query, '\s+', ' ', 'g'), 120) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

-- ---------------------------------------------------------------------
-- 2. Top 20 queries by NUMBER OF CALLS
-- ---------------------------------------------------------------------
-- These are the hot loops. A query at the top of the calls-list with a
-- millisecond mean is still benign; one with a mean > 50ms is a fire.
-- Special call-out: any query with calls > 1M against `crawl_jobs` is the
-- old polling pattern resurfacing — the LISTEN/NOTIFY rewrite should have
-- eliminated it.
\echo ''
\echo '=== TOP 20 BY CALL COUNT ==='
SELECT
    calls,
    round((total_exec_time / calls)::numeric, 2) AS mean_ms,
    round(total_exec_time::numeric, 1) AS total_ms,
    left(regexp_replace(query, '\s+', ' ', 'g'), 120) AS query
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 20;

-- ---------------------------------------------------------------------
-- 3. Tables with the most dead tuples
-- ---------------------------------------------------------------------
-- High dead-tuple ratios = autovacuum is falling behind = bloat = slow
-- sequential scans. A table with >100k dead tuples and <10% dead ratio is
-- fine. Above 30% dead, consider tightening autovacuum on that table:
--   ALTER TABLE x SET (autovacuum_vacuum_scale_factor = 0.05);
\echo ''
\echo '=== DEAD TUPLES BY TABLE ==='
SELECT
    schemaname,
    relname AS table_name,
    n_live_tup AS live_rows,
    n_dead_tup AS dead_rows,
    CASE WHEN n_live_tup > 0
         THEN round((n_dead_tup::numeric / n_live_tup) * 100, 1)
         ELSE NULL END AS dead_pct,
    last_autovacuum
FROM pg_stat_user_tables
WHERE n_dead_tup > 0
ORDER BY n_dead_tup DESC
LIMIT 20;

-- ---------------------------------------------------------------------
-- 4. Index usage
-- ---------------------------------------------------------------------
-- Indexes with idx_scan = 0 are dead weight: writes are paying for them,
-- reads aren't using them. Two reasons not to drop:
--   (a) it's a UNIQUE or PRIMARY KEY (used for constraint enforcement).
--   (b) it was just created and hasn't been scanned yet.
-- Otherwise: consider dropping. Each unused multi-column index easily costs
-- 10-30 MB on a table the size of `recipes`.
\echo ''
\echo '=== UNUSED INDEXES (idx_scan = 0) ==='
SELECT
    s.schemaname,
    s.relname  AS table_name,
    s.indexrelname AS index_name,
    pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
    s.idx_scan
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.idx_scan = 0
  AND NOT i.indisunique
  AND NOT i.indisprimary
ORDER BY pg_relation_size(s.indexrelid) DESC
LIMIT 20;

\echo ''
\echo '=== INDEX HIT RATIO (>= 0.95 is healthy) ==='
SELECT
    schemaname,
    relname AS table_name,
    CASE WHEN (idx_blks_hit + idx_blks_read) > 0
         THEN round(idx_blks_hit::numeric / (idx_blks_hit + idx_blks_read), 3)
         ELSE NULL END AS hit_ratio,
    pg_size_pretty(pg_indexes_size(relid)) AS index_total_size
FROM pg_statio_user_tables
WHERE (idx_blks_hit + idx_blks_read) > 1000
ORDER BY hit_ratio NULLS LAST
LIMIT 15;

-- ---------------------------------------------------------------------
-- 5. Connection count by application / state
-- ---------------------------------------------------------------------
-- Target post-migration: ~10-20 active connections total. A spike to >50
-- usually means a connection leak (the pool isn't returning clients).
\echo ''
\echo '=== CONNECTIONS BY application_name + state ==='
SELECT
    coalesce(application_name, '(unknown)') AS app,
    state,
    count(*) AS conns,
    round(max(EXTRACT(EPOCH FROM (now() - state_change)))::numeric, 1) AS oldest_state_age_s
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY 1, 2
ORDER BY conns DESC;

-- ---------------------------------------------------------------------
-- 6. Materialized view freshness
-- ---------------------------------------------------------------------
-- We rely on a `pg_cron` job to refresh `refresh_materialized_view_stats()`
-- every 5 minutes. If the "age" column drifts past ~10 minutes, the job
-- isn't running — check `cron.job_run_details` (section 8).
\echo ''
\echo '=== MATERIALIZED VIEW FRESHNESS ==='
SELECT
    schemaname,
    matviewname,
    -- Postgres tracks the last refresh in pg_stat_user_tables for a matview
    coalesce(s.last_analyze, s.last_autoanalyze) AS last_refresh_proxy,
    now() - coalesce(s.last_analyze, s.last_autoanalyze) AS age
FROM pg_matviews m
LEFT JOIN pg_stat_user_tables s
       ON s.schemaname = m.schemaname AND s.relname = m.matviewname
ORDER BY m.schemaname, m.matviewname;

-- ---------------------------------------------------------------------
-- 7. Table sizes
-- ---------------------------------------------------------------------
-- Useful for capacity planning and noticing surprise growth (e.g. an audit
-- log that's been growing unbounded for a month).
\echo ''
\echo '=== TOP 15 TABLES BY TOTAL SIZE ==='
SELECT
    schemaname,
    relname AS table_name,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
    pg_size_pretty(pg_relation_size(relid))        AS heap_size,
    pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS indexes_toast,
    n_live_tup AS live_rows
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 15;

-- ---------------------------------------------------------------------
-- 8. pg_cron job status
-- ---------------------------------------------------------------------
-- Requires the postgres role; recipe_readonly can't see cron.job_run_details
-- by default. If you get a permissions error here, re-run this section as
-- `sudo -u postgres psql -d recipe_base`.
\echo ''
\echo '=== pg_cron JOBS (definitions) ==='
SELECT jobid, jobname, schedule, command, active
FROM cron.job
ORDER BY jobid;

\echo ''
\echo '=== pg_cron RECENT RUNS (last 24h) ==='
SELECT
    j.jobname,
    d.start_time,
    d.end_time - d.start_time AS duration,
    d.status,
    left(coalesce(d.return_message, ''), 80) AS message
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE d.start_time > now() - interval '24 hours'
ORDER BY d.start_time DESC
LIMIT 40;

-- ---------------------------------------------------------------------
-- 9. Cache hit ratio (DB-wide)
-- ---------------------------------------------------------------------
-- Target: > 0.99 on a warm DB. If this drops persistently below 0.95, the
-- working set has outgrown shared_buffers — consider raising shared_buffers
-- (currently 128 MB; see memory_baseline.md).
\echo ''
\echo '=== CACHE HIT RATIO (>= 0.99 ideal) ==='
SELECT
    datname,
    blks_hit,
    blks_read,
    round(blks_hit::numeric / NULLIF(blks_hit + blks_read, 0), 4) AS hit_ratio
FROM pg_stat_database
WHERE datname IN ('recipe_base', 'off_mirror')
ORDER BY datname;

-- ---------------------------------------------------------------------
-- 10. Long-running queries right now
-- ---------------------------------------------------------------------
-- Anything over 1 minute is suspicious. Investigate before the next review.
\echo ''
\echo '=== QUERIES RUNNING > 60 SECONDS ==='
SELECT
    pid,
    usename,
    application_name,
    state,
    EXTRACT(EPOCH FROM (now() - query_start))::int AS runtime_s,
    left(regexp_replace(query, '\s+', ' ', 'g'), 200) AS query
FROM pg_stat_activity
WHERE state = 'active'
  AND query_start < now() - interval '60 seconds'
  AND pid <> pg_backend_pid()
ORDER BY query_start;

-- ---------------------------------------------------------------------
-- Done. Optional: reset pg_stat_statements at the END of the review so the
-- next week starts clean. Uncomment to opt in.
-- ---------------------------------------------------------------------
-- SELECT pg_stat_statements_reset();
