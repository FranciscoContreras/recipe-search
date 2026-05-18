-- Self-host fix: drop CONCURRENTLY from refresh_materialized_view_stats().
--
-- Supabase's managed Postgres accepts an expression unique index (`btree ((1))`)
-- as a qualifying index for `REFRESH MATERIALIZED VIEW CONCURRENTLY`. Vanilla
-- Postgres 16 does NOT — it requires the unique index to be on at least one
-- COLUMN, not an expression. So `recipe_stats_singleton_idx ON recipe_stats ((1))`
-- (created by 20260512000001_database_optimizations.sql) is rejected.
--
-- `recipe_stats` is a singleton (one row). A non-CONCURRENT REFRESH takes
-- microseconds and acquires AccessExclusive only for that microsecond, which is
-- imperceptible to clients. Drop the CONCURRENTLY keyword.

CREATE OR REPLACE FUNCTION public.refresh_materialized_view_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW recipe_stats;
END;
$$;

COMMENT ON FUNCTION public.refresh_materialized_view_stats() IS
    'Refreshes recipe_stats. Non-CONCURRENT: the view is a singleton and the lock is microseconds. CONCURRENT removed for vanilla-Postgres compatibility.';
