#!/usr/bin/env bash
#
# 03_backup_nightly.sh — Nightly pg_dump of recipe_base + off_mirror with
# zstd compression and tiered retention.
#
# Installed at: /usr/local/bin/recipe-backup-nightly.sh
# Cron line   : 15 3 * * * postgres /usr/local/bin/recipe-backup-nightly.sh
#
# Intended user: postgres (so .pgpass is not required for local socket auth).
# Run directly: sudo -u postgres /usr/local/bin/recipe-backup-nightly.sh
#
# Layout under ${BACKUP_DEST} (default /home/avion/backups/recipe_base):
#   daily/YYYY-MM-DD.dump.zst
#   weekly/YYYY-MM-DD.dump.zst        (Sundays, kept 8 weeks)
#   monthly/YYYY-MM-DD.dump.zst       (1st of month, kept 12 months)
#   off_mirror/daily/YYYY-MM-DD.dump.zst (last 14 days only)
#
# Retention:
#   daily   — 14 days
#   weekly  — 8 weeks
#   monthly — 12 months
#
# Output: single one-line summary to stdout for cron-mail / health checks:
#   [recipe-backup] OK 2026-05-17 size=42M elapsed=12s
#
set -euo pipefail

BACKUP_DEST="${BACKUP_DEST:-/home/avion/backups/recipe_base}"
DB_PRIMARY="${DB_PRIMARY:-recipe_base}"
DB_OFF="${DB_OFF:-off_mirror}"
ZSTD_LEVEL="${ZSTD_LEVEL:-19}"

DATE="$(date +%Y-%m-%d)"
DOW="$(date +%u)"   # 1..7 with Mon=1, Sun=7
DOM="$(date +%-d)"  # day-of-month, no leading zero
START_TS=$SECONDS

DAILY_DIR="${BACKUP_DEST}/daily"
WEEKLY_DIR="${BACKUP_DEST}/weekly"
MONTHLY_DIR="${BACKUP_DEST}/monthly"
OFF_DIR="${BACKUP_DEST}/off_mirror/daily"

mkdir -p "$DAILY_DIR" "$WEEKLY_DIR" "$MONTHLY_DIR" "$OFF_DIR"
# Lock down the top of the tree in case anyone touched it.
chmod 700 "$BACKUP_DEST" || true

fail() {
    local msg="$1"
    mkdir -p "$BACKUP_DEST"
    printf '%s %s\n' "$(date --iso-8601=seconds)" "$msg" > "${BACKUP_DEST}/last-failure.txt"
    echo "[recipe-backup] FAIL $DATE $msg" >&2
    exit 1
}

trap 'fail "unexpected error (line $LINENO)"' ERR

# Verify zstd is present.
command -v zstd >/dev/null 2>&1 || fail "zstd not installed"

# ---- Primary DB ----
DUMP_PRIMARY="${DAILY_DIR}/${DATE}.dump.zst"
TMP_PRIMARY="${DUMP_PRIMARY}.tmp"
pg_dump --format=custom "$DB_PRIMARY" | zstd "-${ZSTD_LEVEL}" -q -o "$TMP_PRIMARY"
mv -f "$TMP_PRIMARY" "$DUMP_PRIMARY"

# Sunday → copy to weekly. 1st-of-month → copy to monthly.
if [[ "$DOW" == "7" ]]; then
    cp -p "$DUMP_PRIMARY" "${WEEKLY_DIR}/${DATE}.dump.zst"
fi
if [[ "$DOM" == "1" ]]; then
    cp -p "$DUMP_PRIMARY" "${MONTHLY_DIR}/${DATE}.dump.zst"
fi

# ---- OFF mirror ----
# Only dump if the DB actually exists; off_mirror lives in the same cluster.
if psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_OFF}';" | grep -q 1; then
    DUMP_OFF="${OFF_DIR}/${DATE}.dump.zst"
    TMP_OFF="${DUMP_OFF}.tmp"
    pg_dump --format=custom "$DB_OFF" | zstd "-${ZSTD_LEVEL}" -q -o "$TMP_OFF"
    mv -f "$TMP_OFF" "$DUMP_OFF"
fi

# ---- Retention ----
# Use -mtime as a coarse age check; safe enough for daily granularity.
find "$DAILY_DIR"   -maxdepth 1 -type f -name '*.dump.zst' -mtime +14   -delete || true
find "$WEEKLY_DIR"  -maxdepth 1 -type f -name '*.dump.zst' -mtime +56   -delete || true   # 8 wk
find "$MONTHLY_DIR" -maxdepth 1 -type f -name '*.dump.zst' -mtime +366  -delete || true   # 12 mo
find "$OFF_DIR"     -maxdepth 1 -type f -name '*.dump.zst' -mtime +14   -delete || true

# ---- Summary ----
SIZE_HUMAN="$(du -h "$DUMP_PRIMARY" | awk '{print $1}')"
ELAPSED=$(( SECONDS - START_TS ))
echo "[recipe-backup] OK ${DATE} size=${SIZE_HUMAN} elapsed=${ELAPSED}s"
