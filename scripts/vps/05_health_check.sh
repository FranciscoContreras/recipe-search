#!/usr/bin/env bash
#
# 05_health_check.sh — Cron-driven liveness + capacity check for recipe-api.
#
# Checks:
#   - GET http://localhost:3034/health returns 200
#   - DB latency in the JSON payload (if present) is < 1000 ms
#   - /var/lib/postgresql usage < 80%
#
# Logs every run to /var/log/recipe-health.log.
# On failure: appends a richer line to /var/log/recipe-health-failures.log AND,
# if HEALTHCHECK_WEBHOOK is set, POSTs the failure to that URL (5 s timeout).
#
# Designed to be run every 5 minutes from cron (see scripts/vps/README.md).
#
set -euo pipefail

URL="${HEALTH_URL:-http://localhost:3034/health}"
DB_DIR="${DB_DIR:-/var/lib/postgresql}"
DISK_THRESHOLD="${DISK_THRESHOLD:-80}"
LATENCY_THRESHOLD_MS="${LATENCY_THRESHOLD_MS:-1000}"
LOG="${HEALTH_LOG:-/var/log/recipe-health.log}"
FAIL_LOG="${HEALTH_FAIL_LOG:-/var/log/recipe-health-failures.log}"
WEBHOOK="${HEALTHCHECK_WEBHOOK:-}"

TS="$(date --iso-8601=seconds)"

# Make sure the log files are writable; if not, fall back to /tmp so the cron
# job doesn't die silently on first run.
for f in "$LOG" "$FAIL_LOG"; do
    if ! ( touch "$f" 2>/dev/null ); then
        echo "[health-check] WARN: cannot write to $f, switching to /tmp" >&2
        case "$f" in
            "$LOG")      LOG="/tmp/$(basename "$LOG")" ;;
            "$FAIL_LOG") FAIL_LOG="/tmp/$(basename "$FAIL_LOG")" ;;
        esac
        touch "$f" || true
    fi
done

# 1. HTTP check — capture status and body.
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT

HTTP_CODE="$(curl -sS -o "$BODY" -w '%{http_code}' --max-time 10 "$URL" || echo '000')"

# 2. DB latency check — best-effort. If the body looks like JSON and has a
#    db_latency_ms / dbLatencyMs / latency_ms key, extract it without requiring
#    jq.
DB_LATENCY=""
if command -v jq >/dev/null 2>&1; then
    DB_LATENCY="$(jq -r '.db_latency_ms // .dbLatencyMs // .latency_ms // empty' "$BODY" 2>/dev/null || true)"
else
    # Crude fallback regex; tolerates whitespace and quoting variations.
    DB_LATENCY="$(grep -oE '(db_latency_ms|dbLatencyMs|latency_ms)[[:space:]]*:[[:space:]]*[0-9]+' "$BODY" \
                  | head -1 | grep -oE '[0-9]+' || true)"
fi

# 3. Disk usage check.
DISK_USAGE=""
if [[ -d "$DB_DIR" ]]; then
    DISK_USAGE="$(df --output=pcent "$DB_DIR" 2>/dev/null | tail -1 | tr -dc '0-9' || true)"
fi

# Evaluate.
STATUS="OK"
REASON=""

if [[ "$HTTP_CODE" != "200" ]]; then
    STATUS="FAIL"
    REASON="http_status=${HTTP_CODE}"
fi
if [[ "$STATUS" == "OK" && -n "$DB_LATENCY" ]] \
        && [[ "$DB_LATENCY" =~ ^[0-9]+$ ]] \
        && (( DB_LATENCY > LATENCY_THRESHOLD_MS )); then
    STATUS="FAIL"
    REASON="db_latency_ms=${DB_LATENCY}"
fi
if [[ "$STATUS" == "OK" && -n "$DISK_USAGE" ]] \
        && [[ "$DISK_USAGE" =~ ^[0-9]+$ ]] \
        && (( DISK_USAGE > DISK_THRESHOLD )); then
    STATUS="FAIL"
    REASON="disk_usage_pct=${DISK_USAGE}"
fi

LINE="${TS} [health-check] ${STATUS} http=${HTTP_CODE} db_latency_ms=${DB_LATENCY:-?} disk_pct=${DISK_USAGE:-?}"
echo "$LINE" >> "$LOG"

if [[ "$STATUS" != "OK" ]]; then
    SNIPPET="$(head -c 400 "$BODY" | tr '\n' ' ')"
    {
        echo "$LINE reason=${REASON}"
        echo "  body: ${SNIPPET}"
    } >> "$FAIL_LOG"

    if [[ -n "$WEBHOOK" ]]; then
        curl -fsS --max-time 5 -X POST \
            -H "Content-Type: application/json" \
            -d "$(printf '{"status":"%s","ts":"%s","reason":"%s","http":"%s","db_latency_ms":"%s","disk_pct":"%s"}' \
                "$STATUS" "$TS" "$REASON" "$HTTP_CODE" "${DB_LATENCY:-}" "${DISK_USAGE:-}")" \
            "$WEBHOOK" >/dev/null || true
    fi
    exit 1
fi

exit 0
