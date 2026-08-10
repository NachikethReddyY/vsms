#!/bin/sh
set -eu

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

command -v pg_dump >/dev/null 2>&1 || fail "pg_dump is required"
command -v psql >/dev/null 2>&1 || fail "psql is required"
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is required"
[ -n "${VSMS_BACKUP_DIR:-}" ] || fail "VSMS_BACKUP_DIR must be an absolute directory outside this repository"

case "$VSMS_BACKUP_DIR" in /*) ;; *) fail "VSMS_BACKUP_DIR must be absolute" ;; esac
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
case "$VSMS_BACKUP_DIR" in "$repo_root"|"$repo_root"/*) fail "VSMS_BACKUP_DIR must be outside this repository" ;; esac

umask 077
mkdir -p -- "$VSMS_BACKUP_DIR"
database_name=$(psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c 'SELECT current_database()')
[ -n "$database_name" ] || fail "Could not determine the source database"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_file="$VSMS_BACKUP_DIR/vsms-${database_name}-${timestamp}.dump"
manifest_file="$backup_file.counts.tsv"
started_epoch=$(date +%s)

if ! pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$backup_file"; then
  rm -f -- "$backup_file"
  fail "pg_dump failed; partial backup removed"
fi

: > "$manifest_file"
for table_name in events participants event_registrations queue_entries screening_results sync_actions audit_logs; do
  exists=$(psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT to_regclass('public.${table_name}') IS NOT NULL")
  [ "$exists" = "t" ] || { rm -f -- "$backup_file" "$manifest_file"; fail "Required table is missing: $table_name"; }
  row_count=$(psql "$DATABASE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM public.\"${table_name}\"")
  printf '%s\t%s\n' "$table_name" "$row_count" >> "$manifest_file"
done

elapsed=$(( $(date +%s) - started_epoch ))
printf 'Backup created: %s\nRows manifest: %s\nElapsed seconds: %s\n' "$backup_file" "$manifest_file" "$elapsed"
