#!/bin/bash
set -e

# Find the PostgreSQL bin directory (version-specific path on Debian)
PG_BIN=$(find /usr/lib/postgresql/*/bin -maxdepth 0 -type d 2>/dev/null | sort -V | tail -1)
export PATH="$PG_BIN:$PATH"

PGDATA=/var/lib/postgresql/data

# Initialize the Postgres data directory on first run
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "[entrypoint] Initializing PostgreSQL database..."
  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA"
  su postgres -c "initdb -D $PGDATA --auth-host=md5 --auth-local=trust"
fi

# Start Postgres in the background
echo "[entrypoint] Starting PostgreSQL..."
su postgres -c "pg_ctl -D $PGDATA -l /tmp/postgresql.log start"

# Wait until Postgres is ready to accept connections
until su postgres -c "pg_isready -q"; do
  sleep 1
done

# Create the app user and database if they don't exist yet
su postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='appuser'\" | grep -q 1 \
  || psql -c \"CREATE USER appuser WITH PASSWORD 'apppassword';\""
su postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='opportunity_tracker'\" | grep -q 1 \
  || psql -c \"CREATE DATABASE opportunity_tracker OWNER appuser;\""

echo "[entrypoint] Database ready."

# Export DATABASE_URL so the Node process picks it up
export DATABASE_URL=postgresql://appuser:apppassword@localhost:5432/opportunity_tracker

# Hand off to the Node app
echo "[entrypoint] Starting app..."
exec node /app/server/src/index.js
