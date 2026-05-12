#!/usr/bin/env bash
# Generate an API key and insert it directly via the Supabase CLI session.
# No SUPABASE_SERVICE_ROLE_KEY env var required — uses the authenticated CLI session.
#
# Usage:
#   chmod +x src/scripts/generate_key_internal.sh
#   ./src/scripts/generate_key_internal.sh "owner-name" "owner@email.com"
#
# Run from: recipe-api/ or the project root (supabase/ must be accessible)

set -euo pipefail

OWNER_NAME="${1:-internal}"
OWNER_EMAIL="${2:-internal@wearemachina.com}"

# Generate key and hash using Node (available in the project)
read KEY_LINE HASH_LINE < <(node -e "
const c = require('crypto');
const raw = 'sk_' + c.randomBytes(32).toString('hex');
const hash = c.createHash('sha256').update(raw).digest('hex');
process.stdout.write(raw + ' ' + hash);
")

RAW_KEY=$(echo "$KEY_LINE" | awk '{print $1}')
HASH=$(echo "$HASH_LINE" | awk '{print $2}')

# Create a temporary migration file and push it
TMP_SQL="$(mktemp /tmp/key_migration_XXXXXX.sql)"
cat > "$TMP_SQL" << SQLEOF
-- Deactivate any existing active key for this email
UPDATE api_keys SET is_active = false WHERE owner_email = '${OWNER_EMAIL}' AND is_active = true;

-- Insert new key
INSERT INTO api_keys (owner_name, owner_email, key_hash, is_active)
VALUES ('${OWNER_NAME}', '${OWNER_EMAIL}', '${HASH}', true);
SQLEOF

# Use psql via Supabase CLI connection or fall back to db push
MIGRATION_FILE="supabase/migrations/$(date +%Y%m%d%H%M%S)_temp_key_$(echo $OWNER_EMAIL | tr '@.' '_').sql"
PROJ_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

cp "$TMP_SQL" "$PROJ_ROOT/$MIGRATION_FILE"

echo "Pushing key for $OWNER_EMAIL..."
(cd "$PROJ_ROOT" && supabase db push --yes 2>&1 | tail -3)

# Clean up migration file from source after push (key stays in DB)
rm "$PROJ_ROOT/$MIGRATION_FILE"
rm "$TMP_SQL"

echo ""
echo "============================================================"
echo "  API Key generated for: $OWNER_NAME <$OWNER_EMAIL>"
echo "============================================================"
echo "  Key: $RAW_KEY"
echo "============================================================"
echo "  Save this now. It cannot be recovered (hash only stored)."
echo ""
