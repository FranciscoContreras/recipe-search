# VPS operator scripts

Ops glue for the self-hosted `recipe_base` Postgres 16 stack. All scripts live
in this directory in source; the ones that run on a schedule are deployed to
`/usr/local/bin/` on the VPS and invoked via root cron.

| # | Script | Run as | When | Purpose |
|---|---|---|---|---|
| 01 | `01_install_extensions.sh` | root | once, before Phase 2 | apt-installs `postgresql-16-cron` and `postgresql-16-pgvector`, updates `shared_preload_libraries` + `cron.database_name`, restarts Postgres. |
| 02 | `02_create_db_and_roles.sh` | root | once, after 01 | creates the `recipe_base` DB, the three roles (`recipe_owner`, `recipe_app`, `recipe_readonly`), enables all 8 extensions, grants default privileges. Prints the connection strings. |
| 03 | `03_backup_nightly.sh` | postgres (via root cron) | daily 03:15 | `pg_dump` of `recipe_base` and `off_mirror`, zstd-compressed, rotated into `daily/`, `weekly/` (Sundays), `monthly/` (1st). |
| 04 | `04_restore_verify.sh` | postgres (via root cron) | monthly | restores the latest daily dump into `recipe_base_verify`, diffs per-table row counts against live, drops the verify DB. Exits non-zero on mismatch. |
| 05 | `05_health_check.sh` | root cron | every 5 min | hits `localhost:3034/health`, checks DB latency in the JSON, checks `/var/lib/postgresql` disk usage. Logs to `/var/log/recipe-health.log`; failures append to `/var/log/recipe-health-failures.log` and (if `HEALTHCHECK_WEBHOOK` is set) POST to that URL. |

## Required sequence

```
01  install extensions  ─┐
                          ├─→  restore Supabase dump into recipe_base
02  create DB + roles   ─┘    (Phase 4 of the cutover plan)
                                       │
                                       ▼
                  apply supabase/migrations/20260517000000_*.sql
                                       │
                                       ▼
                                cut the app over
                                       │
                  ┌────────────────────┼─────────────────────┐
                  ▼                    ▼                     ▼
       03 install cron        04 monthly verify     05 every 5 min
```

## Deploying the cron jobs

Copy the scripts onto the VPS once (the script files themselves never change
day to day — schedule changes live in the cron files below):

```bash
sudo install -m 0755 -o root -g root scripts/vps/03_backup_nightly.sh /usr/local/bin/recipe-backup-nightly.sh
sudo install -m 0755 -o root -g root scripts/vps/04_restore_verify.sh /usr/local/bin/recipe-restore-verify.sh
sudo install -m 0755 -o root -g root scripts/vps/05_health_check.sh   /usr/local/bin/recipe-health-check.sh
```

### `/etc/cron.d/recipe-backup`

```cron
# Nightly pg_dump of recipe_base + off_mirror (zstd-compressed).
# Logs land in syslog (cron) + /home/avion/backups/recipe_base/last-failure.txt on error.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""

15 3 * * *   postgres /usr/local/bin/recipe-backup-nightly.sh >> /var/log/recipe-backup.log 2>&1

# Monthly automated restore-verify (drops + recreates recipe_base_verify).
0  5 1 * *   postgres /usr/local/bin/recipe-restore-verify.sh >> /var/log/recipe-restore-verify.log 2>&1
```

Install with `sudo install -m 0644 /dev/stdin /etc/cron.d/recipe-backup <<EOF ... EOF`,
or paste into the file with `sudo $EDITOR /etc/cron.d/recipe-backup` and verify
with `sudo crontab -l -u postgres` (won't show — `cron.d` is system-wide) and
`sudo systemctl restart cron`.

### `/etc/cron.d/recipe-health`

```cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
# Optional: set this to your incident webhook (Slack, Discord, etc.) — leave
# blank to rely on log files only.
HEALTHCHECK_WEBHOOK=""

*/5 * * * *  root /usr/local/bin/recipe-health-check.sh
```

## Environment / parameters

| Var | Default | Used by |
|---|---|---|
| `BACKUP_DEST` | `/home/avion/backups/recipe_base` | 03, 04 |
| `DB_PRIMARY` | `recipe_base` | 03 |
| `DB_OFF` | `off_mirror` | 03 |
| `ZSTD_LEVEL` | `19` | 03 |
| `LIVE_DB` | `recipe_base` | 04 |
| `VERIFY_DB` | `recipe_base_verify` | 04 |
| `HEALTH_URL` | `http://localhost:3034/health` | 05 |
| `DB_DIR` | `/var/lib/postgresql` | 05 |
| `DISK_THRESHOLD` | `80` (percent) | 05 |
| `LATENCY_THRESHOLD_MS` | `1000` | 05 |
| `HEALTHCHECK_WEBHOOK` | `""` (disabled) | 05 |
| `RECIPE_APP_PASSWORD` | _generated_ | 02 |
| `RECIPE_READONLY_PASSWORD` | _generated_ | 02 |

## First-run sanity

After deploying cron, force a one-shot run of each to make sure permissions /
paths are right:

```bash
sudo -u postgres /usr/local/bin/recipe-backup-nightly.sh
sudo -u postgres /usr/local/bin/recipe-restore-verify.sh
sudo /usr/local/bin/recipe-health-check.sh && echo ok
```

If `recipe-backup-nightly.sh` writes `daily/YYYY-MM-DD.dump.zst` and prints the
`[recipe-backup] OK` summary line, the schedule will work too. Same for the
others — if the manual run is clean, the cron run will be clean.

## Recovery from a backup

See `docs/runbooks/backup_restore.md` for the full restore procedure (single
table, full DB, disaster recovery from off-VPS storage).
