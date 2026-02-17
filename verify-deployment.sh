#!/bin/bash
# Verify backend deployment (run after deploying)
# Success: health=200, influencer-links=401 (auth required, not 404)

BASE="https://guide-xpert-backend.vercel.app/api"

echo "Verifying deployment..."
echo ""

health=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health")
echo "GET $BASE/health → $health"
if [ "$health" = "200" ]; then
  echo "  ✓ Health OK"
else
  echo "  ✗ Expected 200"
fi

echo ""

influencer=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/influencer-links")
echo "GET $BASE/influencer-links → $influencer"
if [ "$influencer" = "401" ]; then
  echo "  ✓ Route exists (401 = auth required, as expected)"
elif [ "$influencer" = "404" ]; then
  echo "  ✗ 404 = route not found. Redeploy the backend."
else
  echo "  ? Unexpected status"
fi

echo ""
if [ "$health" = "200" ] && [ "$influencer" = "401" ]; then
  echo "Deployment verified. Influencer API is live."
else
  echo "Run: cd backend && vercel --prod"
  echo "Then run this script again."
fi
