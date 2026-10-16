#!/usr/bin/env bash
# Backup (PRD §103): database dump + JSON export of tenant configuration, podcast and distribution metadata.
# Usage: DATABASE_URL=... [API_URL=https://api.example.com API_TOKEN=<super admin token>] ./infrastructure/backup.sh [dir]
# Object storage: enable bucket versioning / replication at the provider (R2, S3, B2, MinIO).
set -euo pipefail
DIR="${1:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DIR"

echo "-> pg_dump"
pg_dump --format=custom --no-owner "$DATABASE_URL" > "$DIR/podcast-$STAMP.dump"

if [[ -n "${API_URL:-}" && -n "${API_TOKEN:-}" ]]; then
  echo "-> metadata export"
  curl -fsS -H "Authorization: Bearer $API_TOKEN" "$API_URL/api/system/backup" > "$DIR/metadata-$STAMP.json"
fi

# Keep the 14 most recent database dumps.
ls -1t "$DIR"/podcast-*.dump 2>/dev/null | tail -n +15 | xargs -r rm --
echo "OK: backup written to $DIR"
