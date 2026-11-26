#!/usr/bin/env bash
# Deploy the latest code from main on your server: builds both parts, publishes the dashboard, restarts.
# Run on the server from the repository folder, e.g. /opt/help-desk:   ./deploy/update.sh
# Needs: VITE_API_URL in the environment or in client/agent-dashboard/.env.production
set -euo pipefail
cd "$(dirname "$0")/.."
WEB_ROOT="${WEB_ROOT:-/var/www/help-desk}"

git pull --ff-only origin main

echo "› Server"
(cd server && npm ci --include=dev && npm run build)

echo "› Dashboard"
if [ -z "${VITE_API_URL:-}" ] && [ ! -f client/agent-dashboard/.env.production ]; then
  echo "Set VITE_API_URL (e.g. https://help.yourco.com) or create client/agent-dashboard/.env.production," >&2
  echo "otherwise the dashboard would try to reach the server at localhost." >&2
  exit 1
fi
(cd client/agent-dashboard && npm ci && npm run build)
sudo rsync -a --delete client/agent-dashboard/dist/ "$WEB_ROOT/"

echo "› Restart"
sudo systemctl restart help-desk
sleep 3
curl -fsS http://127.0.0.1:3000/health && echo && echo "Deployed."
