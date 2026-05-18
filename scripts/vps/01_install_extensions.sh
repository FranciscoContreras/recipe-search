#!/usr/bin/env bash
#
# 01_install_extensions.sh — Install Postgres 16 extensions for recipe_base.
#
# Installs:
#   - postgresql-16-cron      (pg_cron)
#   - postgresql-16-pgvector  (vector)
#
# Edits /etc/postgresql/16/main/postgresql.conf to ensure shared_preload_libraries
# includes pg_stat_statements and pg_cron, then sets cron.database_name=recipe_base.
# Restarts the Postgres service to load the libraries.
#
# Run as: root.
# Usage:
#   sudo bash scripts/vps/01_install_extensions.sh             # apply
#   sudo bash scripts/vps/01_install_extensions.sh --dry-run   # print, don't run
#
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        -h|--help)
            sed -n '2,16p' "$0"
            exit 0
            ;;
        *)
            echo "unknown arg: $arg" >&2
            exit 2
            ;;
    esac
done

if [[ $EUID -ne 0 ]]; then
    echo "must be root" >&2
    exit 1
fi

PG_CONF="/etc/postgresql/16/main/postgresql.conf"
PG_SERVICE="postgresql@16-main"

run() {
    if [[ $DRY_RUN -eq 1 ]]; then
        printf '[dry-run] %s\n' "$*"
    else
        printf '[run] %s\n' "$*"
        eval "$@"
    fi
}

if [[ ! -f "$PG_CONF" && $DRY_RUN -eq 0 ]]; then
    echo "postgres conf not found at $PG_CONF — is Postgres 16 installed?" >&2
    exit 1
fi

echo "==> apt-get update"
run "apt-get update"

echo "==> apt-get install -y postgresql-16-cron postgresql-16-pgvector"
run "apt-get install -y postgresql-16-cron postgresql-16-pgvector"

# Backup postgresql.conf
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${PG_CONF}.bak-${TIMESTAMP}"
echo "==> backing up ${PG_CONF} -> ${BACKUP}"
run "cp -p '$PG_CONF' '$BACKUP'"

# Edit shared_preload_libraries idempotently.
# Required libs: pg_stat_statements, pg_cron.
# Strategy:
#   - If an active (uncommented) line exists, parse its current value, merge in
#     the required libs (preserving anything else already there), and rewrite it.
#   - Otherwise (only commented-out defaults present), append a new active line.
edit_shared_preload() {
    local conf="$1"
    if [[ $DRY_RUN -eq 1 ]]; then
        echo "[dry-run] would update shared_preload_libraries in $conf"
        return 0
    fi
    awk '
        BEGIN { handled = 0 }
        # Match an active (non-commented) shared_preload_libraries line.
        /^[[:space:]]*shared_preload_libraries[[:space:]]*=/ {
            # Extract value between the first pair of single or double quotes.
            value = $0
            q = ""
            if (match(value, /\047[^\047]*\047/)) {
                q = substr(value, RSTART + 1, RLENGTH - 2)
            } else if (match(value, /"[^"]*"/)) {
                q = substr(value, RSTART + 1, RLENGTH - 2)
            }
            # Build set of existing libs.
            n = split(q, arr, /[ ,]+/)
            has_stat = 0; has_cron = 0
            for (i = 1; i <= n; i++) {
                if (arr[i] == "pg_stat_statements") has_stat = 1
                if (arr[i] == "pg_cron")            has_cron = 1
            }
            new = q
            if (!has_stat) new = (new == "" ? "pg_stat_statements" : new ",pg_stat_statements")
            if (!has_cron) new = (new == "" ? "pg_cron"             : new ",pg_cron")
            # Strip spaces in the comma list for tidy output.
            gsub(/[[:space:]]/, "", new)
            print "shared_preload_libraries = \047" new "\047"
            handled = 1
            next
        }
        { print }
        END {
            if (!handled) {
                print "shared_preload_libraries = \047pg_stat_statements,pg_cron\047"
            }
        }
    ' "$conf" > "${conf}.new"
    mv "${conf}.new" "$conf"
    chown --reference="$BACKUP" "$conf"
    chmod --reference="$BACKUP" "$conf"
}

echo "==> updating shared_preload_libraries"
edit_shared_preload "$PG_CONF"

# Set or replace a single GUC line idempotently.
#   set_guc <name> <quoted-value>
# Example: set_guc cron.database_name "'recipe_base'"
set_guc() {
    local name="$1" value="$2"
    if [[ $DRY_RUN -eq 1 ]]; then
        echo "[dry-run] would set ${name} = ${value} in $PG_CONF"
        return 0
    fi
    if grep -qE "^[[:space:]]*${name//./\\.}[[:space:]]*=" "$PG_CONF"; then
        awk -v n="$name" -v v="$value" '
            $0 ~ "^[[:space:]]*" n "[[:space:]]*=" { print n " = " v; next }
            { print }
        ' "$PG_CONF" > "${PG_CONF}.new"
        mv "${PG_CONF}.new" "$PG_CONF"
        chown --reference="$BACKUP" "$PG_CONF"
        chmod --reference="$BACKUP" "$PG_CONF"
    else
        printf "%s = %s\n" "$name" "$value" >> "$PG_CONF"
    fi
}

# pg_cron config:
#   cron.database_name           — which DB owns the cron schema (only one per cluster)
#   cron.host                    — unix-socket path so pg_cron auths via peer
#   cron.use_background_workers  — skip the libpq layer entirely (avoids any
#                                  pg_hba.conf surprises)
echo "==> setting cron.* config"
set_guc cron.database_name           "'recipe_base'"
set_guc cron.host                    "'/var/run/postgresql'"
set_guc cron.use_background_workers  "on"

echo "==> restarting $PG_SERVICE"
run "systemctl restart $PG_SERVICE"

echo "==> verifying service is active"
if [[ $DRY_RUN -eq 0 ]]; then
    systemctl is-active "$PG_SERVICE" >/dev/null || {
        echo "ERROR: $PG_SERVICE is not active after restart" >&2
        systemctl status "$PG_SERVICE" --no-pager || true
        exit 1
    }
fi

echo
echo "==============================================================="
echo " Summary"
echo "==============================================================="
if [[ $DRY_RUN -eq 1 ]]; then
    echo " (dry-run — nothing actually changed)"
else
    PG_VERSION="$(sudo -u postgres psql -tAc 'SHOW server_version;' 2>/dev/null || echo 'unknown')"
    INSTALLED_PKGS="$(dpkg -l postgresql-16-cron postgresql-16-pgvector 2>/dev/null \
        | awk '/^ii/ {printf "  %-30s %s\n", $2, $3}')"
    SPL_LINE="$(grep -E '^[[:space:]]*shared_preload_libraries[[:space:]]*=' "$PG_CONF" | tail -1 || true)"
    CRON_LINES="$(grep -E '^[[:space:]]*cron\.' "$PG_CONF" | tail -5 || true)"
    echo " Postgres version : $PG_VERSION"
    echo " Installed packages:"
    echo "${INSTALLED_PKGS:-  (none)}"
    echo " postgresql.conf:"
    echo "   $SPL_LINE"
    echo "$CRON_LINES" | sed 's/^/   /'
    echo " Backup of conf saved to: $BACKUP"
fi
echo "==============================================================="
echo "Done. Next: run scripts/vps/02_create_db_and_roles.sh"
