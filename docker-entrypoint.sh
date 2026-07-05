#!/bin/sh
set -e

# Ensure data directory exists
mkdir -p /app/data/storage

# Run migrations and seed if database is fresh
node src/db/migrate.js
node src/db/seed.js

echo "Otero ready, starting server..."
exec "$@"
