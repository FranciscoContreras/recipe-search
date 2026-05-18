#!/usr/bin/env bash
#
# 02_create_db_and_roles.sh — Create the recipe_base database, roles, extensions
# and default privileges for the self-hosted recipe-base stack.
#
# Idempotent: re-running is safe. Skips creation of existing roles/DB.
#
# Reads passwords from env (preferred):
#   RECIPE_APP_PASSWORD       — password for the LOGIN role recipe_app
#   RECIPE_READONLY_PASSWORD  — password for the LOGIN role recipe_readonly
#   RECIPE_OWNER_PASSWORD     — password for the LOGIN role recipe_owner
#                               (used by migrate.ts to apply schema changes)
# If unset, generates them with `openssl rand -base64 24` and prints them at the
# end so the operator can copy them into recipe-api/.env.
#
# Also creates Supabase-compat stub roles (anon, authenticated, service_role)
# as NOLOGIN so historical migrations that GRANT to them apply cleanly. The
# 20260517000000_self_host_compat.sql migration REVOKEs everything from them.
#
# Run as: root. The script shells out to `sudo -u postgres psql` for the actual
# SQL work, so the postgres OS user must exist (default after installing
# postgresql-server-16).
#
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "must be root" >&2
    exit 1
fi

DB_NAME="recipe_base"
PSQL_SUPER=(sudo -u postgres psql -v ON_ERROR_STOP=1)
GENERATED_APP=0
GENERATED_RO=0
GENERATED_OWNER=0

if [[ -z "${RECIPE_APP_PASSWORD:-}" ]]; then
    RECIPE_APP_PASSWORD="$(openssl rand -base64 24 | tr -d '\n')"
    GENERATED_APP=1
fi
if [[ -z "${RECIPE_READONLY_PASSWORD:-}" ]]; then
    RECIPE_READONLY_PASSWORD="$(openssl rand -base64 24 | tr -d '\n')"
    GENERATED_RO=1
fi
if [[ -z "${RECIPE_OWNER_PASSWORD:-}" ]]; then
    RECIPE_OWNER_PASSWORD="$(openssl rand -base64 24 | tr -d '\n')"
    GENERATED_OWNER=1
fi

# Convenience wrapper.
psql_super() {
    "${PSQL_SUPER[@]}" "$@"
}

echo "==> creating Supabase-compat stub roles (NOLOGIN)"
# Historical Supabase migrations GRANT to anon/authenticated/service_role.
# Create them as inert NOLOGIN roles so the GRANTs apply; the self-host compat
# migration (20260517000000) REVOKEs everything from them at the end.
psql_super -tAc "DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
END\$\$;"

# Same case-guard as below.
case "$RECIPE_APP_PASSWORD$RECIPE_READONLY_PASSWORD$RECIPE_OWNER_PASSWORD" in
    *\'*|*\\*) echo "passwords must not contain ' or \\" >&2; exit 1 ;;
esac

echo "==> creating recipe_owner (LOGIN, owns the schema; used by migrate.ts)"
psql_super -tAc "DO \$do\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recipe_owner') THEN
        EXECUTE 'CREATE ROLE recipe_owner LOGIN PASSWORD ' || quote_literal('${RECIPE_OWNER_PASSWORD}');
    ELSE
        EXECUTE 'ALTER ROLE recipe_owner LOGIN PASSWORD ' || quote_literal('${RECIPE_OWNER_PASSWORD}');
    END IF;
END
\$do\$;"

# recipe_app — LOGIN, runs the API.
# Note: psql client variables (`-v foo=bar`) are NOT visible inside DO blocks.
# We shell-substitute into a SQL literal; the case-guard above blocks injection.
psql_super -tAc "DO \$do\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recipe_app') THEN
        EXECUTE 'CREATE ROLE recipe_app LOGIN PASSWORD ' || quote_literal('${RECIPE_APP_PASSWORD}');
    ELSE
        EXECUTE 'ALTER ROLE recipe_app LOGIN PASSWORD ' || quote_literal('${RECIPE_APP_PASSWORD}');
    END IF;
END
\$do\$;"

# recipe_readonly — LOGIN, for ad-hoc psql sessions and reporting.
psql_super -tAc "DO \$do\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recipe_readonly') THEN
        EXECUTE 'CREATE ROLE recipe_readonly LOGIN PASSWORD ' || quote_literal('${RECIPE_READONLY_PASSWORD}');
    ELSE
        EXECUTE 'ALTER ROLE recipe_readonly LOGIN PASSWORD ' || quote_literal('${RECIPE_READONLY_PASSWORD}');
    END IF;
END
\$do\$;"

echo "==> creating database $DB_NAME if missing"
DB_EXISTS="$(psql_super -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}';" || true)"
if [[ "${DB_EXISTS}" != "1" ]]; then
    psql_super -tAc "CREATE DATABASE ${DB_NAME};"
fi

echo "==> setting owner"
psql_super -tAc "ALTER DATABASE ${DB_NAME} OWNER TO recipe_owner;"

echo "==> enabling extensions inside ${DB_NAME}"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS vector;
SQL

echo "==> granting connect + schema usage"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <<'SQL'
GRANT CONNECT ON DATABASE recipe_base TO recipe_app, recipe_readonly;

GRANT USAGE  ON SCHEMA public TO recipe_app, recipe_readonly;
GRANT CREATE ON SCHEMA public TO recipe_owner;

-- Existing objects (in case the DB was pre-populated by a restore).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO recipe_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO recipe_app;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA public TO recipe_app;
GRANT SELECT                         ON ALL TABLES    IN SCHEMA public TO recipe_readonly;

-- Future objects created by recipe_owner.
ALTER DEFAULT PRIVILEGES FOR ROLE recipe_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO recipe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE recipe_owner IN SCHEMA public
    GRANT USAGE, SELECT                  ON SEQUENCES TO recipe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE recipe_owner IN SCHEMA public
    GRANT EXECUTE                        ON FUNCTIONS TO recipe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE recipe_owner IN SCHEMA public
    GRANT SELECT                         ON TABLES    TO recipe_readonly;

-- Also cover defaults created directly by postgres (e.g. ad-hoc \dt+ created tables).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO recipe_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT                  ON SEQUENCES TO recipe_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE                        ON FUNCTIONS TO recipe_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT                         ON TABLES    TO recipe_readonly;
SQL

echo "==> sanity check: extensions present"
sudo -u postgres psql -d "${DB_NAME}" \
    -c "SELECT extname FROM pg_extension ORDER BY extname;"

echo
echo "==============================================================="
echo " Summary"
echo "==============================================================="
echo " Database     : ${DB_NAME}"
echo " Roles        : recipe_owner (NOLOGIN), recipe_app (LOGIN), recipe_readonly (LOGIN)"
echo " Extensions   : pg_trgm, pgcrypto, uuid-ossp, pg_stat_statements,"
echo "                unaccent, btree_gin, pg_cron, vector"
echo
echo " Connection strings (copy these into recipe-api/.env):"
echo "   DATABASE_URL=postgresql://recipe_app:${RECIPE_APP_PASSWORD}@localhost:5432/${DB_NAME}"
echo "   READONLY_URL=postgresql://recipe_readonly:${RECIPE_READONLY_PASSWORD}@localhost:5432/${DB_NAME}"
echo "   OWNER_URL=postgresql://recipe_owner:${RECIPE_OWNER_PASSWORD}@localhost:5432/${DB_NAME}   (used by migrate.ts only)"
echo
if [[ $GENERATED_APP -eq 1 || $GENERATED_RO -eq 1 || $GENERATED_OWNER -eq 1 ]]; then
    echo " NOTE: the following passwords were auto-generated this run."
    echo "       Store them now — they will NOT be shown again."
    [[ $GENERATED_APP   -eq 1 ]] && echo "   recipe_app       : ${RECIPE_APP_PASSWORD}"
    [[ $GENERATED_RO    -eq 1 ]] && echo "   recipe_readonly  : ${RECIPE_READONLY_PASSWORD}"
    [[ $GENERATED_OWNER -eq 1 ]] && echo "   recipe_owner     : ${RECIPE_OWNER_PASSWORD}"
fi
echo "==============================================================="
echo
echo "Validating recipe_app can list extensions..."
PGPASSWORD="${RECIPE_APP_PASSWORD}" \
    psql -U recipe_app -h localhost -d "${DB_NAME}" \
    -c "SELECT extname FROM pg_extension ORDER BY extname;" || {
        echo "WARNING: recipe_app login check failed. Confirm pg_hba.conf permits password auth on localhost." >&2
    }
echo "Done. Next: restore the data dump (Phase 4)."
