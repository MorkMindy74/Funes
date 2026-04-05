#!/bin/sh
set -e

echo "=== Funes API Starting ==="

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL..."
MAX_RETRIES=30
RETRY=0
until node -e "
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
pool.query('SELECT 1').then(() => { pool.end(); process.exit(0); }).catch(() => { pool.end(); process.exit(1); });
" 2>/dev/null; do
  RETRY=$((RETRY + 1))
  if [ $RETRY -ge $MAX_RETRIES ]; then
    echo "ERROR: PostgreSQL not available after ${MAX_RETRIES} retries"
    exit 1
  fi
  echo "PostgreSQL not ready (attempt $RETRY/$MAX_RETRIES), retrying in 2s..."
  sleep 2
done
echo "PostgreSQL is ready!"

# Push schema to database (creates/updates tables automatically)
echo "Syncing database schema..."
npx drizzle-kit push --force 2>&1 || echo "WARNING: Schema push failed — tables may need manual setup"

echo "Starting Funes API server..."
exec node dist/index.js
