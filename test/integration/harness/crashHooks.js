'use strict';

const { recoverStuckReminderJobs, repairReminderJobLifecycle } = require('../../../services/whatsappReminderJobLifecycle');

/**
 * @param {string} point WA_TEST_CRASH_POINT value
 * @param {() => Promise<unknown>} fn
 */
async function withCrashPoint(point, fn) {
  const prev = process.env.WA_TEST_CRASH_POINT;
  process.env.WA_TEST_CRASH_POINT = point;
  try {
    return await fn();
  } catch (e) {
    if (e && e.code === 'WA_TEST_CRASH') return { crashed: true, point };
    throw e;
  } finally {
    if (prev == null) delete process.env.WA_TEST_CRASH_POINT;
    else process.env.WA_TEST_CRASH_POINT = prev;
  }
}

/**
 * @param {{ now?: Date, messageKinds?: string[] }} [opts]
 */
async function runRecoveryAfterCrash(opts = {}) {
  const now = opts.now || new Date();
  const kinds = opts.messageKinds || ['pre4hr', 'meet', '30min'];
  const recover = await recoverStuckReminderJobs({ now, messageKinds: kinds, limit: 200 });
  const repair = await repairReminderJobLifecycle({ now, messageKinds: kinds, limit: 200 });
  return { recover, repair };
}

module.exports = {
  withCrashPoint,
  runRecoveryAfterCrash
};
