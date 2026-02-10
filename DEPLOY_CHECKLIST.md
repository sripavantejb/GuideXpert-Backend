# 🚀 Deployment Checklist

## Quick Start

Follow these steps to deploy the fixes:

### Step 1: Verify Changes
✅ **Files modified:**
- `vercel.json` - Added Vercel serverless configuration
- `controllers/meetController.js` - Fixed OTP storage for serverless
- `models/OtpVerification.js` - Added user info fields
- `models/MeetEntry.js` - Added 'pending' status

### Step 2: Commit Changes

```bash
cd /Users/sripavantejbalam/Desktop/GuideXpert/backend

# Stage all changes
git add .

# Commit with descriptive message
git commit -m "Fix serverless issues: add Vercel config and MongoDB OTP storage"

# Push to trigger deployment
git push origin main
```

### Step 3: Verify Environment Variables in Vercel

Go to your Vercel dashboard and verify these are set:

**Required:**
- [ ] `MONGODB_URI` - MongoDB Atlas connection string
- [ ] `MSG91_AUTH_KEY` - Your MSG91 auth key
- [ ] `MSG91_TEMPLATE_ID` - Your MSG91 template ID
- [ ] `OTP_SECRET` - Strong random string
- [ ] `GOOGLE_MEET_LINK` - Your Google Meet link
- [ ] `ADMIN_JWT_SECRET` - Admin JWT secret
- [ ] `COUNSELLOR_JWT_SECRET` - Counsellor portal JWT secret (mobile OTP login)
- [ ] `FRONTEND_URL` - https://guidexpert.co.in (or your frontend URL)

**Optional:**
- [ ] `OTP_EXPIRY_MINUTES` - Default: 5
- [ ] `GOOGLE_SHEETS_CREDENTIALS_JSON` - For sheets integration
- [ ] `GOOGLE_SHEET_ID` - Your sheet ID

### Step 4: Wait for Deployment

Vercel will automatically deploy. Watch the progress at:
- Dashboard: https://vercel.com/dashboard
- Or use CLI: `vercel logs --follow`

### Step 5: Test the Endpoints

**Test 1 - Health Check:**
```bash
curl https://guide-xpert-backend.vercel.app/api/health
```
Expected: `{"status":"ok","message":"GuideXpert API is running"}`

**Test 2 - Send OTP:**
```bash
curl -X POST https://guide-xpert-backend.vercel.app/api/meet/send-otp \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","mobile":"9876543210"}'
```
Expected: `{"success":true,"message":"OTP sent successfully..."}`

**Test 3 - Frontend Test:**
1. Go to your frontend
2. Navigate to meet registration page
3. Fill in the form
4. Click "Send OTP"
5. Check your phone for OTP SMS
6. Enter the OTP
7. Should successfully register and get Meet link!

### Step 6: Monitor Logs

If anything fails, check logs:
```bash
vercel logs guide-xpert-backend --follow
```

Or in Vercel Dashboard → Your Project → Logs

## Common Issues & Solutions

### Issue: MongoDB Connection Error
**Solution:** 
1. Verify `MONGODB_URI` is correct in Vercel
2. Check MongoDB Atlas → Network Access → Add 0.0.0.0/0 (allow all IPs)
3. Verify MongoDB cluster is running

### Issue: Still Getting 404
**Solution:**
1. Make sure `vercel.json` is in the backend root directory
2. Redeploy: `vercel --prod`
3. Check Vercel dashboard shows latest deployment

### Issue: Still Getting 500
**Solution:**
1. Check Vercel logs for actual error
2. Verify ALL required environment variables are set
3. Test MongoDB connection separately
4. Check MSG91 credentials are valid

### Issue: OTP Not Sending
**Solution:**
1. Verify MSG91_AUTH_KEY and MSG91_TEMPLATE_ID in Vercel
2. Check MSG91 dashboard for API credits
3. Verify mobile number format (10 digits)
4. Check Vercel logs for SMS gateway errors

### Issue: CORS Error
**Solution:**
1. Add your frontend URL to `FRONTEND_URL` environment variable
2. Format: `https://guidexpert.co.in` (no trailing slash)
3. Redeploy backend after changing env vars

## Success Indicators

✅ Health endpoint returns 200 OK
✅ Send OTP returns success message
✅ SMS received on mobile
✅ Verify OTP succeeds
✅ Meet link returned
✅ No console errors in frontend

## Need Help?

1. **Check logs first:** `vercel logs guide-xpert-backend --follow`
2. **Verify environment variables:** Vercel Dashboard → Settings → Environment Variables
3. **Test MongoDB:** Try connecting to your MongoDB URI using MongoDB Compass
4. **Test MSG91:** Check MSG91 dashboard for API status and credits

## Important Notes

- 🔒 **Never commit** `.env` file or credentials
- 🔄 **Always redeploy** after changing environment variables
- 📊 **Monitor logs** during first few test registrations
- 🧪 **Test thoroughly** before sharing Meet link with users

## Timeline

Typical deployment takes:
- Git push → 30 seconds to trigger
- Vercel build → 1-2 minutes
- Total → ~2-3 minutes

## Contact

If you encounter issues:
1. Check both `DEPLOYMENT.md` and `SERVERLESS_FIX.md`
2. Review Vercel logs for specific errors
3. Verify all environment variables are set correctly
