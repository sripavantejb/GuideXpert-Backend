/**
 * Shared OSVI outbound processing: atomic claim pending -> processing, then OSVI API.
 * Used by save-step3 (waitUntil) and /api/cron/osvi-outbound-due (backup).
 */

const FormSubmission = require('../models/FormSubmission');
const { initiateOutboundCall, isOsviConfigured } = require('./osviService');
const { getCronSecretForOutboundPing } = require('./cronSecret');

/**
 * Process one pending OSVI job for a phone when scheduled time has passed.
 * @param {string} phone - 10-digit normalized phone
 * @returns {Promise<{ ok: boolean, status?: string, reason?: string, error?: string }>}
 */
async function processOsviOutboundForPhone(phone) {
  const sfx = phone.slice(-4);

  if (!isOsviConfigured()) {
    console.warn(`[OSVI] Skipped ***${sfx}: OSVI not configured (token/agent env)`);
    return { ok: false, reason: 'not_configured' };
  }

  const claimed = await FormSubmission.findOneAndUpdate(
    {
      phone,
      osviOutboundCallStatus: 'pending',
      osviOutboundScheduledAt: { $lte: new Date() },
    },
    { $set: { osviOutboundCallStatus: 'processing', updatedAt: new Date() } },
    { new: true }
  );

  if (!claimed) {
    console.log(
      `[OSVI] Skipped ***${sfx}: no claimable pending job (not due yet, already processing, or already done)`
    );
    return { ok: false, reason: 'not_due_or_already_claimed' };
  }

  console.log(`[OSVI] Claimed pending job for ***${sfx} — OSVI /call will run next`);

  const person_name =
    (claimed.step1Data && claimed.step1Data.fullName) || claimed.fullName || 'Counsellor';
  const occupation =
    (claimed.step1Data && claimed.step1Data.occupation) || claimed.occupation || 'Applicant';

  try {
    const r = await initiateOutboundCall({
      phone_number: phone,
      person_name: String(person_name).trim(),
      occupation: String(occupation).trim() || 'Applicant',
    });

    if (r.success) {
      await FormSubmission.updateOne(
        { phone },
        {
          $set: {
            osviOutboundCallStatus: 'completed',
            osviOutboundCompletedAt: new Date(),
            osviOutboundLastError: null,
          },
        }
      );
      console.log(`[OSVI] Job ***${sfx}: OSVI API reported success (status completed)`);
      return { ok: true, status: 'completed' };
    }

    const errMsg = (r.error && String(r.error).slice(0, 500)) || 'Unknown error';
    await FormSubmission.updateOne(
      { phone },
      {
        $set: {
          osviOutboundCallStatus: 'failed',
          osviOutboundLastError: errMsg,
        },
      }
    );
    console.warn(`[OSVI] Job ***${sfx}: OSVI API reported failure —`, errMsg);
    return { ok: false, status: 'failed', error: errMsg };
  } catch (err) {
    const msg = err && err.message ? String(err.message).slice(0, 500) : 'Exception';
    await FormSubmission.updateOne(
      { phone },
      { $set: { osviOutboundCallStatus: 'failed', osviOutboundLastError: msg } }
    );
    console.error(`[OSVI] Job ***${sfx}: exception before/after OSVI call`, err);
    return { ok: false, status: 'exception', error: msg };
  }
}

/**
 * After slot booking: wait delayMs then run OSVI for this phone.
 * On Vercel, uses waitUntil so the work is not frozen after res.send (requires maxDuration >= delay).
 * Locally, fire-and-forget async run.
 * @param {string} phone
 * @param {number} delayMs
 */
function scheduleDelayedOsviOutbound(phone, delayMs) {
  const sfx = phone.slice(-4);
  console.log(
    `[OSVI] Delayed outbound: waiting ${delayMs}ms then processing ***${sfx} (waitUntil + local timer; Vercel may also ping cron)`
  );

  const run = async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      console.log(`[OSVI] Delay elapsed for ***${sfx} — triggering OSVI pipeline`);

      const vercelHost = process.env.VERCEL_URL;
      const cronSecret = getCronSecretForOutboundPing();

      // On Vercel, hit the cron URL from this runtime so a follow-up request processes pending rows.
      // (Express often has no @vercel/functions request context, so waitUntil is a no-op — this keeps OSVI working.)
      if (vercelHost && cronSecret) {
        const cronUrl = `https://${vercelHost}/api/cron/osvi-outbound-due?key=${encodeURIComponent(cronSecret)}`;
        try {
          console.log(`[OSVI] GET cron processor (pending OSVI jobs) — host ${vercelHost}`);
          const res = await fetch(cronUrl, { method: 'GET' });
          const text = await res.text();
          console.log(`[OSVI] Cron GET ${res.status}:`, text.slice(0, 400));
        } catch (fetchErr) {
          console.error('[OSVI] Cron GET failed; falling back to in-process processor', fetchErr);
          const result = await processOsviOutboundForPhone(phone);
          console.log(`[OSVI] In-process fallback summary ***${sfx}:`, result);
        }
      } else {
        const result = await processOsviOutboundForPhone(phone);
        console.log(`[OSVI] Delayed job summary ***${sfx}:`, result);
      }
    } catch (e) {
      console.error(`[OSVI] scheduleDelayedOsviOutbound failed ***${sfx}`, e);
    }
  };

  try {
    const { waitUntil } = require('@vercel/functions');
    if (typeof waitUntil === 'function') {
      waitUntil(run());
    }
  } catch (_) {
    /* @vercel/functions optional */
  }

  // Always schedule on the Node event loop. On Vercel, waitUntil often does nothing for Express;
  // without this, the delayed job never ran (only waitUntil was used and context was empty).
  void run();
}

/**
 * Fire a GET to /api/cron/osvi-outbound-due in a *new* serverless invocation.
 * The current request's Lambda often freezes right after res.json, so any work
 * scheduled with setTimeout in the same invocation may never run on Vercel.
 * Call this after persisting a row with osviOutboundScheduledAt <= now.
 */
async function pingCronForOsviJobs() {
  const host = process.env.VERCEL_URL;
  const key = getCronSecretForOutboundPing();
  if (!host || !key) {
    console.warn('[OSVI] pingCronForOsviJobs skipped: VERCEL_URL or GUIDEXPERT_CRON_SECRET/CRON_SECRET missing');
    return;
  }
  const cronUrl = `https://${host}/api/cron/osvi-outbound-due?key=${encodeURIComponent(key)}`;
  console.log(
    '[OSVI] Pinging cron endpoint (new invocation) →',
    cronUrl.replace(/key=[^&]+/, 'key=***')
  );
  try {
    const res = await fetch(cronUrl, { method: 'GET' });
    const text = await res.text();
    console.log(`[OSVI] Cron ping HTTP ${res.status}:`, text.slice(0, 500));
  } catch (err) {
    console.error('[OSVI] Cron ping failed:', err);
  }
}

module.exports = {
  processOsviOutboundForPhone,
  scheduleDelayedOsviOutbound,
  pingCronForOsviJobs,
};
