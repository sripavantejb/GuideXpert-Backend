#!/bin/bash
# Deploy backend to Vercel production
# Requires: vercel CLI installed and logged in (run 'vercel login' first)

set -e
cd "$(dirname "$0")"

echo "Deploying backend to Vercel production..."
vercel --prod

echo ""
echo "Deployment complete. Verify with:"
echo "  curl https://guide-xpert-backend.vercel.app/api/health"
echo "  curl -i https://guide-xpert-backend.vercel.app/api/influencer-links"
echo ""
echo "Expected: health returns 200, influencer-links returns 401 (auth required, not 404)"
