-- =============================================================================
-- File:     20260517000000_self_host_compat.sql
-- Purpose:  Self-host compatibility layer for the Recipe API database.
--           Originally targeted Supabase Cloud (RLS + anon/authenticated/
--           service_role + PostgREST). This migration neutralises Supabase-
--           specific objects so the same schema runs on a vanilla Postgres 16
--           installation owned by the application via the `recipe_app` role.
--
-- Order:    MUST run AFTER all prior migrations in this directory.
--           The in-house migrator (`recipe-api/src/scripts/migrate.ts`)
--           walks the directory alphabetically and tracks applied filenames
--           in `public.schema_migrations` so this file runs exactly once.
--
-- Idempotency:
--           Safe to re-run end-to-end. Every statement uses one of:
--             - IF EXISTS / IF NOT EXISTS
--             - CREATE OR REPLACE
--             - DO $$ BEGIN ... EXCEPTION WHEN <code> THEN NULL; END $$
--             - DROP-then-CREATE for triggers / cron jobs
--
-- Pre-installed by `scripts/vps/01_install_extensions.sh` (Phase 1):
--           - shared_preload_libraries = 'pg_stat_statements,pg_cron'
--           - postgresql-16-cron + postgresql-16-pgvector apt packages
--           - cron.database_name = 'recipe_base' in postgresql.conf
--           - `recipe_app` + `recipe_readonly` LOGIN roles already exist
--           - `vector` and `pg_cron` extensions already created in the DB
--           Section 1 below re-runs `CREATE EXTENSION IF NOT EXISTS` for both
--           as a safety net and to document the requirement.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. EXTENSIONS (idempotent)
-- -----------------------------------------------------------------------------
-- All extensions installed on the database. Most are created in Phase 1; the
-- IF NOT EXISTS guards make this file standalone for fresh installs too.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_cron;


-- -----------------------------------------------------------------------------
-- 2. DROP ALL RLS POLICIES + DISABLE ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
-- The new architecture authenticates at the Postgres connection layer via the
-- `recipe_app` role. RLS policies that reference Supabase-managed roles
-- (`anon`, `authenticated`, `service_role`) would silently deny all access
-- once those roles are removed, so we drop every policy and disable RLS.

-- recipes (from 20251214000000_create_recipes_table.sql)
DROP POLICY IF EXISTS "Enable read access for all users"   ON public.recipes;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.recipes;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.recipes;

-- crawl_jobs (from 20251214000001_create_crawl_jobs.sql)
DROP POLICY IF EXISTS "Enable read access for all users"   ON public.crawl_jobs;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.crawl_jobs;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.crawl_jobs;

-- ingredient_cache (from 20251214000008_ingredient_cache.sql)
-- Note: the actual policy names in that migration are "Enable insert for
-- service role" and "Enable update for service role" (not the …all users
-- form used on recipes / crawl_jobs). Both name variants are dropped to be
-- bullet-proof against future drift.
DROP POLICY IF EXISTS "Enable read access for all users"   ON public.ingredient_cache;
DROP POLICY IF EXISTS "Enable insert for service role"     ON public.ingredient_cache;
DROP POLICY IF EXISTS "Enable update for service role"     ON public.ingredient_cache;
DROP POLICY IF EXISTS "Enable insert access for all users" ON public.ingredient_cache;
DROP POLICY IF EXISTS "Enable update access for all users" ON public.ingredient_cache;

-- api_keys (from 20251225000002_add_api_keys.sql)
DROP POLICY IF EXISTS "Service role only" ON public.api_keys;

-- off_products (from 20260511000001_off_products_table.sql)
DROP POLICY IF EXISTS "Public read"         ON public.off_products;
DROP POLICY IF EXISTS "Service role write"  ON public.off_products;

-- cnf_foods / frida_foods / ausnut_foods (from 20260512200004_nutrition_source_tables.sql)
DROP POLICY IF EXISTS "Public read"         ON public.cnf_foods;
DROP POLICY IF EXISTS "Service role write"  ON public.cnf_foods;
DROP POLICY IF EXISTS "Public read"         ON public.frida_foods;
DROP POLICY IF EXISTS "Service role write"  ON public.frida_foods;
DROP POLICY IF EXISTS "Public read"         ON public.ausnut_foods;
DROP POLICY IF EXISTS "Service role write"  ON public.ausnut_foods;

-- Disable RLS on every affected table. ALTER TABLE … DISABLE RLS is
-- idempotent (no error if RLS already disabled).
ALTER TABLE public.recipes          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.crawl_jobs       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_cache DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.off_products     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cnf_foods        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.frida_foods      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ausnut_foods     DISABLE ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- 3. REVOKE GRANTS TO SUPABASE-MANAGED ROLES (safe-if-roles-absent)
-- -----------------------------------------------------------------------------
-- On a freshly created self-hosted Postgres the anon / authenticated /
-- service_role roles do NOT exist. Wrap the REVOKE statements so the
-- migration succeeds either way.

DO $$
BEGIN
    EXECUTE 'REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated, service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;


-- -----------------------------------------------------------------------------
-- 4. GRANT PRIVILEGES TO THE APPLICATION ROLE
-- -----------------------------------------------------------------------------
-- `recipe_app` (LOGIN, used by the API + worker + auditor) and
-- `recipe_readonly` (LOGIN, used by ad-hoc queries + verify scripts) are
-- created out-of-band by `scripts/vps/02_create_db_and_roles.sh` in Phase 1.
-- Wrap the GRANTs in role-existence guards so this migration is also valid
-- against a database whose roles haven't yet been provisioned (e.g. CI).

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recipe_app') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA public TO recipe_app';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO recipe_app';
        EXECUTE 'GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO recipe_app';
        EXECUTE 'GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA public TO recipe_app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO recipe_app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT                  ON SEQUENCES TO recipe_app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE                        ON FUNCTIONS TO recipe_app';
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recipe_readonly') THEN
        EXECUTE 'GRANT USAGE ON SCHEMA public TO recipe_readonly';
        EXECUTE 'GRANT SELECT         ON ALL TABLES    IN SCHEMA public TO recipe_readonly';
        EXECUTE 'GRANT USAGE, SELECT  ON ALL SEQUENCES IN SCHEMA public TO recipe_readonly';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT        ON TABLES    TO recipe_readonly';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO recipe_readonly';
    END IF;
END $$;


-- -----------------------------------------------------------------------------
-- 5. LISTEN / NOTIFY TRIGGERS ON crawl_jobs
-- -----------------------------------------------------------------------------
-- Replaces the 5-60s polling loop in `recipe-api/src/worker.ts`. A worker
-- session keeps `LISTEN crawl_jobs_new;` open. When a new job is inserted
-- (or a cooling_down job becomes pending again on retry), Postgres fires a
-- NOTIFY and the worker wakes within milliseconds.

CREATE OR REPLACE FUNCTION public.notify_crawl_job()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_notify('crawl_jobs_new', NEW.id::text);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crawl_jobs_notify ON public.crawl_jobs;
CREATE TRIGGER crawl_jobs_notify
    AFTER INSERT ON public.crawl_jobs
    FOR EACH ROW
    WHEN (NEW.status = 'pending')
    EXECUTE FUNCTION public.notify_crawl_job();

-- Retry wake-up: a job transitioning from cooling_down → pending also needs
-- to wake a worker. Plain INSERT trigger won't fire on UPDATEs so this is a
-- second trigger keyed on UPDATE OF status.

CREATE OR REPLACE FUNCTION public.notify_crawl_job_retry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'pending' AND OLD.status = 'cooling_down' THEN
        PERFORM pg_notify('crawl_jobs_new', NEW.id::text);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crawl_jobs_notify_retry ON public.crawl_jobs;
CREATE TRIGGER crawl_jobs_notify_retry
    AFTER UPDATE OF status ON public.crawl_jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_crawl_job_retry();


-- -----------------------------------------------------------------------------
-- 6. audit_pending_batch(p_limit int) — lightweight auditor moved into SQL
-- -----------------------------------------------------------------------------
-- The previous Node auditor process (`recipe-api/src/auditor.ts`) polled the
-- recipes table every ~10 s and burned ~6 GB / month of Supabase egress on
-- `SELECT recipes.*`. The heavy paths (live nutrition enrichment, remote
-- image validation, dedupe re-checks) STAY in the Node auditor on a
-- much-reduced cadence — they can't run in pure SQL. This function handles
-- the cheap structural checks so pg_cron can keep the qa_status column
-- moving without any network round-trip.
--
-- Returns: count of rows updated. pg_cron writes this to the cron.job_run_details table.

CREATE OR REPLACE FUNCTION public.audit_pending_batch(p_limit int)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated integer := 0;
BEGIN
    WITH candidates AS (
        SELECT id
        FROM public.recipes
        WHERE qa_status = 'pending' OR last_audited_at IS NULL
        ORDER BY id
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    ),
    upd AS (
        UPDATE public.recipes r
        SET
            qa_status = CASE
                WHEN r.image IS NULL
                  OR r.recipe_instructions IS NULL
                  OR jsonb_array_length(r.recipe_instructions) = 0
                THEN 'quarantined'
                ELSE 'verified'
            END,
            last_audited_at = now(),
            audit_log = COALESCE(r.audit_log, '[]'::jsonb)
                        || jsonb_build_array('Auto-audited by pg_cron at ' || now()::text)
        FROM candidates c
        WHERE r.id = c.id
        RETURNING r.id
    )
    SELECT count(*) INTO v_updated FROM upd;

    RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.audit_pending_batch(int) IS
    'Lightweight structural audit for recipes (image + instructions presence). '
    'Called every 5 minutes by pg_cron job audit-pending-batch. '
    'Heavy enrichment paths (nutrition, image validation) remain in the Node auditor.';


-- -----------------------------------------------------------------------------
-- 7. pg_cron SCHEDULES
-- -----------------------------------------------------------------------------
-- pg_cron stores schedules in the `cron` schema (created when the extension
-- was installed in Phase 1 / Section 1). cron.schedule() inserts into cron.job.
-- Re-running this migration would create duplicate entries with the same
-- jobname; the unschedule-by-name guard prevents that. Wrap in a DO block so
-- the migration doesn't abort if a job didn't previously exist.

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'refresh-recipe-stats' LOOP
        PERFORM cron.unschedule(r.jobid);
    END LOOP;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT jobid FROM cron.job WHERE jobname = 'audit-pending-batch' LOOP
        PERFORM cron.unschedule(r.jobid);
    END LOOP;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Refresh the recipe_stats materialized view (used by /health) every 5 min.
SELECT cron.schedule(
    'refresh-recipe-stats',
    '*/5 * * * *',
    $$ SELECT refresh_materialized_view_stats(); $$
);

-- Lightweight auditor pass every 5 min, batch of 50.
SELECT cron.schedule(
    'audit-pending-batch',
    '*/5 * * * *',
    $$ SELECT public.audit_pending_batch(50); $$
);


-- -----------------------------------------------------------------------------
-- 8. FOOTER
-- -----------------------------------------------------------------------------
-- COMMENT ON DATABASE requires a literal identifier, so we look up the current
-- database name from pg_database and EXECUTE a dynamically-built statement.

DO $$
DECLARE
    v_dbname text;
BEGIN
    SELECT current_database() INTO v_dbname;
    EXECUTE format(
        'COMMENT ON DATABASE %I IS %L',
        v_dbname,
        'Recipe API self-hosted Postgres. Compat layer applied 2026-05-17.'
    );
END $$;
