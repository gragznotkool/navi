#!/usr/bin/env bash
# Restores a dump into the database from DATABASE_ADMIN_URL: pg_restore --clean --if-exists.
# Usage: scripts/restore.sh [backup/opshub-<timestamp>.dump]   (defaults to the newest dump)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${DATABASE_ADMIN_URL:-}" ] && [ -f .env ]; then
  DATABASE_ADMIN_URL="$(grep -E '^DATABASE_ADMIN_URL=' .env | head -1 | cut -d= -f2-)"
fi
: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL is not set (env or .env)}"
command -v pg_restore >/dev/null || { echo "pg_restore not found. Install PostgreSQL client tools." >&2; exit 1; }

file="${1:-$(ls -1t backup/opshub-*.dump 2>/dev/null | head -1 || true)}"
[ -n "$file" ] && [ -f "$file" ] || { echo "No dump file found. Pass one as the first argument." >&2; exit 1; }

echo "Restoring $file (existing objects are dropped first)..."
pg_restore --clean --if-exists --no-owner --exit-on-error --dbname="$DATABASE_ADMIN_URL" "$file"
echo "Restore complete."
