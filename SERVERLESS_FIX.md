# Serverless Architecture Fix for OTP System

## Problem Summary

The OTP verification system was failing with 500 errors on Vercel because of a **critical serverless architecture issue**.

### Root Cause

The original implementation used **in-memory storage** (`Map` objects) to store OTPs:

```javascript
// ❌ PROBLEM: In-memory storage
const meetOtpStore = new Map();
const otpRateLimits = new Map();
```

**Why this fails on serverless:**
1. User sends OTP → Serverless Instance A stores it in memory
2. User verifies OTP → Serverless Instance B has empty memory
3. Result: "Invalid or expired OTP" errors (or 500 errors)

Each serverless function invocation can be handled by a different instance, and memory is not shared between instances!

## Solution

Replaced in-memory storage with **MongoDB persistent storage** using the existing `OtpVerification` model.

### Changes Made

#### 1. **Updated OtpVerification Model** (`models/OtpVerification.js`)
Added fields to store user details:
- `name` - User's full name
- `email` - User's email address

These fields allow us to retrieve user information when verifying the OTP.

#### 2. **Updated MeetEntry Model** (`models/MeetEntry.js`)
Added `'pending'` status to track entries before OTP verification:
- `pending` - OTP sent but not verified
- `registered` - OTP verified successfully
- `joined` - User joined the meet

#### 3. **Refactored meetController.js**
Replaced all in-memory operations with database operations:

**Before:**
```javascript
meetOtpStore.set(mobile, { otpHash, expiresAt, attempts, name, email });
```

**After:**
```javascript
await OtpVerification.create({
  phoneNumber: mobile,
  otpHash,
  expiresAt,
  attempts: 0,
  name,
  email
});
```

**Rate Limiting:**
- Before: `Map` to track last send time
- After: Query MongoDB for recent OTP entries

**OTP Storage:**
- Before: In-memory `Map`
- After: MongoDB `OtpVerification` collection

**OTP Cleanup:**
- Before: `setInterval()` to clean up (doesn't work across instances)
- After: MongoDB TTL index automatically deletes expired documents

## Benefits

1. ✅ **Works on serverless** - State persists across different instances
2. ✅ **More reliable** - Database is the source of truth
3. ✅ **Automatic cleanup** - MongoDB TTL index removes expired OTPs
4. ✅ **Better rate limiting** - Consistent across all instances
5. ✅ **Audit trail** - All OTP attempts are logged in the database

## Files Modified

1. `backend/models/OtpVerification.js` - Added name and email fields
2. `backend/models/MeetEntry.js` - Added 'pending' status
3. `backend/controllers/meetController.js` - Replaced in-memory storage with MongoDB
4. `backend/vercel.json` - Added Vercel configuration (separate fix)

## Deployment Instructions

1. **Commit all changes:**
   ```bash
   cd backend
   git add .
   git commit -m "Fix serverless OTP storage issue - use MongoDB instead of in-memory"
   ```

2. **Push to trigger deployment:**
   ```bash
   git push
   ```

3. **Verify environment variables in Vercel:**
   - `MONGODB_URI` - MongoDB connection string (required!)
   - `MSG91_AUTH_KEY` - MSG91 authentication key
   - `MSG91_TEMPLATE_ID` - MSG91 template ID
   - `OTP_SECRET` - Secret for OTP hashing
   - `GOOGLE_MEET_LINK` - Google Meet link
   - All other required variables from `.env.example`

4. **Test the endpoints:**
   ```bash
   # Send OTP
   curl -X POST https://guide-xpert-backend.vercel.app/api/meet/send-otp \
     -H "Content-Type: application/json" \
     -d '{"name":"Test User","email":"test@example.com","mobile":"9876543210"}'
   
   # Verify OTP (use actual OTP from SMS)
   curl -X POST https://guide-xpert-backend.vercel.app/api/meet/verify-otp \
     -H "Content-Type: application/json" \
     -d '{"mobile":"9876543210","otp":"123456"}'
   ```

## Important Notes

- **MongoDB connection is critical** - The entire OTP system now depends on MongoDB being available
- **TTL Index** - The `OtpVerification` model has a TTL index that auto-deletes expired documents
- **No more in-memory storage** - All state is now in the database
- **Serverless-ready** - This implementation works correctly in serverless environments

## Database Indexes

The `OtpVerification` model uses these indexes:
- `{ phoneNumber: 1 }` - Fast lookup by phone number
- `{ expiresAt: 1 }, { expireAfterSeconds: 0 }` - TTL index for automatic cleanup

## Testing Checklist

- [ ] Send OTP to a mobile number
- [ ] Wait 30 seconds and try to resend (should get rate limit error)
- [ ] Verify OTP with correct code (should succeed)
- [ ] Try to register same number again (should get "already registered" error)
- [ ] Send OTP and wait >5 minutes, then verify (should get "expired" error)
- [ ] Send OTP and try 3 wrong codes (should get "too many attempts" error)

## Troubleshooting

**Still getting 500 errors?**
1. Check Vercel logs: `vercel logs guide-xpert-backend --follow`
2. Verify MongoDB connection string is correct
3. Check that MongoDB allows connections from Vercel IPs (0.0.0.0/0)
4. Verify all environment variables are set

**OTP not being stored?**
1. Check MongoDB connection in logs
2. Verify `OtpVerification` model is properly registered
3. Check database write permissions

**Rate limiting not working?**
1. Verify MongoDB queries are returning results
2. Check `createdAt` field is being set correctly
3. Look for database query errors in logs
