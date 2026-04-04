/**
 * Shared OSVI outbound processing: atomic claim pending -> processing, then OSVI API.
 * Used by save-step3 (waitUntil) and /api/cron/osvi-outbound-due (backup).
 */

const FormSubmission = require('../models/FormSubmission');
const { initiateOutboundCall, isOsviConfigured } = require('./osviService');

/**
 * Process one pending OSVI job for a phone when scheduled time has passed.
 * @param {string} phone - 10-digit normalized phone
 * @returns {Promise<{ ok: boolean, status?: string, reason?: string, error?: string }>}
 */
async function processOsviOutboundForPhone(phone) {
  if (!isOsviConfigured()) {
    console.warn('[OSVI] processOsviOutboundForPhone: not configured');
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
    return { ok: false, reason: 'not_due_or_already_claimed' };
  }

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
      console.log('[OSVI] Outbound call completed for phone ending', phone.slice(-4));
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
    console.warn('[OSVI] Outbound call failed', errMsg);
    return { ok: false, status: 'failed', error: errMsg };
  } catch (err) {
    const msg = err && err.message ? String(err.message).slice(0, 500) : 'Exception';
    await FormSubmission.updateOne(
      { phone },
      { $set: { osviOutboundCallStatus: 'failed', osviOutboundLastError: msg } }
    );
    console.error('[OSVI] processOsviOutboundForPhone exception', err);
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
  const run = async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const result = await processOsviOutboundForPhone(phone);
      if (!result.ok && result.reason !== 'not_due_or_already_claimed') {
        console.log('[OSVI] Delayed job result', phone.slice(-4), result);
      }
    } catch (e) {
      console.error('[OSVI] scheduleDelayedOsviOutbound failed', e);
    }
  };

  let usedWaitUntil = false;
  try {
    const { waitUntil } = require('@vercel/functions');
    if (typeof waitUntil === 'function') {
      waitUntil(run());
      usedWaitUntil = true;
    }
  } catch (_) {
    /* optional dependency path */
  }
  if (!usedWaitUntil) {
    void run();
  }
}

module.exports = {
  processOsviOutboundForPhone,
  scheduleDelayedOsviOutbound,
};
