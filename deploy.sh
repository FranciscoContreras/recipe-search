#!/bin/bash
set -e

# Configuration
SERVER_USER="root"
SERVER_HOST="server.wearemachina.com"
REMOTE_DIR="/home/wearemachina-recipe-base/htdocs/recipe-base.wearemachina.com/"
SITE_USER="wearemachina-recipe-base"

echo "🚀 Starting deployment..."

# 1. Build locally
echo "📦 Building project locally..."
cd recipe-api
# Ensure dependencies are installed (dev deps needed for build)
npm install
npm run build
cd ..

# 2. Sync files
echo "Cc Syncing files to server..."
# Exclude node_modules (reinstall on server), .env (keep server config), git, etc.
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude '.env' --exclude '.DS_Store' --exclude 'debug_keys.log' \
  recipe-api/ "$SERVER_USER@$SERVER_HOST:$REMOTE_DIR"

# 3. Server-side commands
echo "🔄 Running server-side updates..."
ssh "$SERVER_USER@$SERVER_HOST" << EOF
  # Fix ownership
  echo "   - Fixing permissions..."
  chown -R $SITE_USER:$SITE_USER $REMOTE_DIR

  # Run build/restart as the site user
  echo "   - Installing dependencies and reloading PM2..."
  su - $SITE_USER -c "cd $REMOTE_DIR && npm install --production && pm2 reload ecosystem.config.js"
EOF

echo "✅ Deployment complete!"
