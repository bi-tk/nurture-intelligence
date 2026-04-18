#!/bin/bash
# Run this ONCE after adding the Neon database to Vercel.
# It pulls the DATABASE_URL from Vercel env and runs migrations + seed.

set -e

echo "Pulling Vercel environment variables..."
vercel env pull .env.production.local --environment=production

echo "Running migrations..."
DATABASE_URL=$(grep DATABASE_URL .env.production.local | cut -d '=' -f2- | tr -d '"')
DATABASE_URL=$DATABASE_URL npx prisma migrate deploy

echo "Running seed (creates default users + benchmarks)..."
DATABASE_URL=$DATABASE_URL npm run db:seed

echo "Cleaning up..."
rm -f .env.production.local

echo "✅ Done — production database is ready."
