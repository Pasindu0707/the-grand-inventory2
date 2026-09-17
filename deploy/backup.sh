#!/usr/bin/env bash
# Nightly database backup.
#
#   sudo crontab -e
#   15 2 * * *  /opt/thegrand/deploy/backup.sh >> /var/log/thegrand-backup.log 2>&1
#
# A dump sitting on the same machine as the database is not a backup -- it is a
# second copy of the same risk. Set RCLONE_REMOTE so each dump is copied off the
# server; everything below the upload step assumes you have.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"

# shellcheck disable=SC1091
set -a; source "$HERE/.env"; set +a

BACKUP_DIR="${BACKUP_DIR:-/opt/thegrand/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M)"
FILE="$BACKUP_DIR/thegrand_${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date -Is)] dumping to $FILE"

# --clean --if-exists so the dump can be restored over an existing database
# without hand-dropping it first, which is exactly the situation you are in
# when you are restoring under pressure.
docker compose -f "$ROOT/deploy/docker-compose.prod.yml" --env-file "$HERE/.env" \
	exec -T db pg_dump \
	--username "$POSTGRES_USER" \
	--dbname "$POSTGRES_DB" \
	--clean --if-exists --no-owner --no-privileges \
	| gzip -9 > "$FILE"

SIZE=$(stat -c %s "$FILE")
if [ "$SIZE" -lt 10000 ]; then
	echo "[$(date -Is)] FAILED: dump is only ${SIZE} bytes -- refusing to treat this as a backup" >&2
	rm -f "$FILE"
	exit 1
fi

echo "[$(date -Is)] wrote $FILE ($(numfmt --to=iec "$SIZE"))"

# Uploads too. The photographs of cash slips are the only evidence a cash
# purchase ever has -- losing them loses the audit trail, not just a file.
UPLOADS="$BACKUP_DIR/uploads_${STAMP}.tar.gz"
docker run --rm -v thegrand_uploads:/u:ro -v "$BACKUP_DIR":/out alpine \
	tar czf "/out/$(basename "$UPLOADS")" -C /u . 2>/dev/null || {
	echo "[$(date -Is)] WARNING: uploads archive failed" >&2
}

if [ -n "${RCLONE_REMOTE:-}" ]; then
	echo "[$(date -Is)] uploading to $RCLONE_REMOTE"
	rclone copy "$FILE" "$RCLONE_REMOTE/thegrand/db/"
	[ -f "$UPLOADS" ] && rclone copy "$UPLOADS" "$RCLONE_REMOTE/thegrand/uploads/"
else
	echo "[$(date -Is)] WARNING: RCLONE_REMOTE is empty -- this backup never leaves the server" >&2
fi

find "$BACKUP_DIR" -name 'thegrand_*.sql.gz' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'uploads_*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "[$(date -Is)] done"
