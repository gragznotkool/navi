#!/usr/bin/env bash
# Creates backup/opshub-<timestamp>.dump with `pg_dump -Fc` using DATABASE_ADMIN_URL (env or repo .env).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${DATABASE_ADMIN_URL:-}" ] && [ -f .env ]; then
  DATABASE_ADMIN_URL="$(grep -E '^DATABASE_ADMIN_URL=' .env | head -1 | cut -d= -f2-)"
fi
: "${DATABASE_ADMIN_URL:?DATABASE_ADMIN_URL is not set (env or .env)}"
command -v pg_dump >/dev/null || { echo "pg_dump not found. Install PostgreSQL client tools or run it inside the postgres container." >&2; exit 1; }

mkdir -p backup
out="backup/opshub-$(date +%Y%m%d-%H%M%S).dump"
pg_dump -Fc --no-owner --dbname="$DATABASE_ADMIN_URL" --file="$out"
echo "Backup written to $out ($(wc -c <"$out") bytes)"
