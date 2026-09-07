#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

available="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "select count(*) from pg_available_extensions where name = 'vector'")"

if [ "$available" != "1" ]; then
  echo "pgvector is not available in this PostgreSQL image" >&2
  exit 1
fi

printf '%s\n' vector-ready
