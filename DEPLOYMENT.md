# Backend Deployment Guide

## Issues Fixed

### 1. Routing Issue (404 Errors)
Added `vercel.json` configuration file to properly route requests to the Express server on Vercel.

### 2. Serverless OTP Storage Issue (500 Errors)
**Critical Fix:** Replaced in-memory storage with MongoDB for OTP management.
- **Problem:** In-memory `Map` objects don't persist across serverless function invocations
- **Solution:** Use MongoDB `OtpVerification` collection for persistent storage
- **Result:** OTP system now works correctly in serverless environment

See `SERVERLESS_FIX.md` for detailed technical explanation.

## Deployment Steps

### 1. **Redeploy to Vercel**

If you're using Vercel CLI:
```bash
cd backend
vercel --prod
```

If you're using Vercel Dashboard:
1. Go to your Vercel dashboard
2. Select your backend project (guide-xpert-backend)
3. Go to Settings → Git
4. Trigger a new deployment or push changes to your connected Git repository

### 2. **Verify Environment Variables**

Make sure these environment variables are set in your Vercel project settings:

**Required for OTP:**
- `MSG91_AUTH_KEY` - Your MSG91 authentication key
- `MSG91_TEMPLATE_ID` - Your DLT template ID
- `OTP_SECRET` - Strong random string for OTP hashing
- `OTP_EXPIRY_MINUTES` - OTP expiry time (default: 5)

**Required for Database:**
- `MONGODB_URI` - Your MongoDB Atlas connection string

**Required for Admin:**
- `ADMIN_JWT_SECRET` - JWT secret for admin authentication

**Required for CORS:**
- `FRONTEND_URL` - Your frontend URL (e.g., https://guidexpert.co.in)

**Required for Google Meet:**
- `GOOGLE_MEET_LINK` - Your Google Meet link for the session

**Optional (for Google Sheets):**
- `GOOGLE_SHEETS_CREDENTIALS_JSON` - Service account JSON as a single line
- `GOOGLE_SHEET_ID` - Google Sheet ID
- `GOOGLE_SHEET_RANGE` - Sheet range (e.g., Formresponses)

### 3. **Test the Endpoints**

After deployment, test these endpoints:

```bash
# Health check
curl https://guide-xpert-backend.vercel.app/api/health

# Send OTP (should not return 404)
curl -X POST https://guide-xpert-backend.vercel.app/api/meet/send-otp \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","mobile":"9876543210"}'
```

### 4. **Common Issues**

**404 on Influencer Endpoints** (`/api/influencer-links`, `/api/influencer-analytics`):
- Cause: The live deployment does not include the influencer routes.
- Fix: Redeploy the backend so the latest code is deployed.
  1. Ensure you are logged in: `vercel login`
  2. Deploy: `cd backend && vercel --prod`
  3. Or run: `./deploy.sh` from the backend directory.
- Verify: `curl -i https://guide-xpert-backend.vercel.app/api/influencer-links` should return 401 (auth required), not 404.

**404 Error (general):**
- Make sure `vercel.json` is in the backend root directory
- Redeploy after adding `vercel.json`

**500 Error:**
- Check Vercel logs for detailed error messages
- Verify all required environment variables are set
- Check MongoDB connection string is correct
- Verify MSG91 credentials are valid

**CORS Error:**
- Make sure `FRONTEND_URL` environment variable matches your frontend domain
- Check that your frontend domain is in the allowedOrigins array

### 5. **View Logs**

To debug issues:
```bash
vercel logs guide-xpert-backend --follow
```

Or view logs in Vercel Dashboard → Your Project → Logs

## vercel.json Configuration

The `vercel.json` file tells Vercel how to handle the Express.js application:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "server.js"
    }
  ]
}
```

This configuration:
- Builds the `server.js` file using the Node.js runtime
- Routes all requests to the Express server

## Next Steps

1. Push the changes to your Git repository (if connected)
2. Vercel will automatically deploy
3. Or manually trigger deployment using Vercel CLI
4. Test the endpoints
5. Your frontend should now work correctly!
