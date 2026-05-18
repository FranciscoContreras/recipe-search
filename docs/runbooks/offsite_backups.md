# Offsite backups (Cloudflare R2 / Backblaze B2)

The nightly `recipe-backup-nightly.sh` cron writes to `/var/backups/recipe_base/`
on the VPS by default. That's enough to recover from a disk-corruption or
DB-eaten-by-vacuum incident, but **not** enough if the VPS itself is lost
(hardware failure, hostname goes away, account suspended, etc.).

This runbook activates the optional offsite step that's already wired into the
backup script — it does nothing unless `BACKUP_REMOTE` is set in the cron env.

## Recommended target: Cloudflare R2

- 10 GB / month free; egress is free (matters if you ever restore from cloud).
- S3-compatible. rclone treats it identically to B2/S3.
- One bucket per environment is fine.

Backblaze B2 works the same way; trade the free egress for slightly cheaper
storage at scale ($0.005/GB-month vs. R2's $0.015/GB-month past the free 10 GB).

## One-time setup (root on VPS)

### 1. Install rclone

```bash
apt update && apt install -y rclone
```

### 2. Configure the remote

```bash
rclone config
```

Interactive prompts — answer with:

- `n` → new remote
- Name: `r2` (or `backblaze` — match what you'll put in the cron env)
- Storage: choose `s3` for R2/B2 (both speak S3-compat); for native B2
  type `b2`.

**For R2:**
- provider: `Cloudflare`
- access_key_id: from R2 dashboard → "Manage R2 API Tokens"
- secret_access_key: same place
- region: `auto`
- endpoint: `https://<account-id>.r2.cloudflarestorage.com`

**For B2 (native):**
- account: B2 application key ID
- key: B2 application key
- (no endpoint needed)

Confirm with `rclone lsd r2:` — should print your buckets.

### 3. Create the bucket

```bash
rclone mkdir r2:recipe-base-backups        # or whatever name
```

### 4. Tell cron to push

Edit `/etc/cron.d/recipe-backup` and add the env var:

```cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
BACKUP_DEST=/var/backups/recipe_base
BACKUP_REMOTE=r2:recipe-base-backups          # ← add this line

15 3 * * *   postgres /usr/local/bin/recipe-backup-nightly.sh >> /var/log/recipe-backup.log 2>&1
0  5 1 * *   postgres /usr/local/bin/recipe-restore-verify.sh >> /var/log/recipe-restore-verify.log 2>&1
```

The rclone config lives at `/root/.config/rclone/rclone.conf` by default. The
cron job runs as `postgres`, which doesn't read root's config — copy or symlink:

```bash
mkdir -p ~postgres/.config/rclone
cp /root/.config/rclone/rclone.conf ~postgres/.config/rclone/
chown -R postgres:postgres ~postgres/.config
chmod 600 ~postgres/.config/rclone/rclone.conf
```

### 5. Manual test

```bash
sudo -u postgres /usr/local/bin/recipe-backup-nightly.sh
```

The last line should print
`[recipe-backup] OK 2026-05-18 size=21M elapsed=12s offsite=ok`.

If you see `offsite=skipped(no-rclone)` rclone isn't on `$PATH` for the
postgres user — check the cron's `PATH=` line.

If you see `offsite=FAIL` run rclone manually as postgres to see the real error:

```bash
sudo -u postgres rclone copy --verbose /var/backups/recipe_base r2:recipe-base-backups/recipe_base
```

## Retention strategy

The local script deletes daily dumps older than 14 d, weeklies older than 8 w,
monthlies older than 12 mo. The cloud sync **does not** delete — anything ever
uploaded stays, forever, until you clean it up manually. This is intentional:
cloud storage is cheap; restore-from-old-backup is occasionally lifesaving.

Periodically (every few months) you can prune the cloud with:

```bash
rclone delete --min-age 1y r2:recipe-base-backups/recipe_base/daily
```

## Restoring from cloud

```bash
# List what's available
rclone lsl r2:recipe-base-backups/recipe_base/daily | tail -10

# Pull a specific dump
rclone copy r2:recipe-base-backups/recipe_base/daily/2026-05-18.dump.zst /tmp/

# Restore (see backup_restore.md for the full procedure)
zstd -dc /tmp/2026-05-18.dump.zst | pg_restore \
    --no-owner --no-acl --dbname=recipe_base_restored
```

## Cost expectations

Current DB size: 208 MB → ~21 MB zstd compressed dump. OFF mirror: 1.4 GB →
174 MB compressed. Total per night: ~195 MB.

Over a year of nightly + weekly + monthly retention: ~80 GB.

- **R2**: free 10 GB + 70 × $0.015 = **$1.05 / month**
- **B2**: 80 × $0.005 = **$0.40 / month**

Either is rounding error. The bigger cost is your time to set up `rclone` once.
