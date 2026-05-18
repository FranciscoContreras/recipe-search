#!/usr/bin/env bash
#
# 04_restore_verify.sh — Monthly automated test of backup integrity.
#
# Picks the latest daily dump under ${BACKUP_DEST}/daily, restores it into a
# throwaway database `recipe_base_verify`, then compares per-table row counts
# to the live `recipe_base`. Exits 0 on a clean match, 1 on any mismatch.
#
# Intended user: postgres (uses local socket).
# Schedule:      monthly (cron line in scripts/vps/README.md).
#
set -euo pipefail

BACKUP_DEST="${BACKUP_DEST:-/var/backups/recipe_base}"
LIVE_DB="${LIVE_DB:-recipe_base}"
VERIFY_DB="${VERIFY_DB:-recipe_base_verify}"

DAILY_DIR="${BACKUP_DEST}/daily"

# Pick the most-recent .dump.zst by lexical order (filenames are YYYY-MM-DD).
LATEST=""
if [[ -d "$DAILY_DIR" ]]; then
    LATEST="$(find "$DAILY_DIR" -maxdepth 1 -type f -name '*.dump.zst' \
              | sort | tail -1)"
fi
if [[ -z "$LATEST" ]]; then
    echo "[restore-verify] FAIL no .dump.zst found in $DAILY_DIR" >&2
    exit 1
fi
echo "[restore-verify] latest dump: $LATEST"

cleanup() {
    psql -q -tAc "DROP DATABASE IF EXISTS ${VERIFY_DB};" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Recreate verify DB.
psql -q -tAc "DROP DATABASE IF EXISTS ${VERIFY_DB};"
psql -q -tAc "CREATE DATABASE ${VERIFY_DB};"

echo "[restore-verify] restoring into ${VERIFY_DB}..."
zstd -dc "$LATEST" | pg_restore \
    --no-owner --no-acl --dbname="${VERIFY_DB}" \
    --exit-on-error >/dev/null
echo "[restore-verify] restore complete"

# Build a per-table comparison.
# Pull table list from the live DB (public schema, base tables only).
TABLES="$(psql -tAc "SELECT tablename FROM pg_tables \
                     WHERE schemaname='public' ORDER BY tablename;" "$LIVE_DB")"

mismatches=0
total=0
printf "%-45s %15s %15s %10s\n" "table" "live" "verify" "diff"
printf "%-45s %15s %15s %10s\n" "-----" "----" "------" "----"
while IFS= read -r tbl; do
    [[ -z "$tbl" ]] && continue
    total=$(( total + 1 ))
    LIVE_COUNT="$(psql -tAc "SELECT count(*) FROM public.\"${tbl}\";" "$LIVE_DB" 2>/dev/null || echo 'ERR')"
    VERIFY_COUNT="$(psql -tAc "SELECT count(*) FROM public.\"${tbl}\";" "$VERIFY_DB" 2>/dev/null || echo 'ERR')"
    if [[ "$LIVE_COUNT" == "$VERIFY_COUNT" ]]; then
        diff_marker="ok"
    else
        diff_marker="MISMATCH"
        mismatches=$(( mismatches + 1 ))
    fi
    printf "%-45s %15s %15s %10s\n" "$tbl" "$LIVE_COUNT" "$VERIFY_COUNT" "$diff_marker"
done <<< "$TABLES"

echo
if [[ $mismatches -eq 0 ]]; then
    echo "[restore-verify] OK ${total} tables match (dump: $(basename "$LATEST"))"
    exit 0
else
    echo "[restore-verify] FAIL ${mismatches}/${total} tables mismatch (dump: $(basename "$LATEST"))" >&2
    exit 1
fi
