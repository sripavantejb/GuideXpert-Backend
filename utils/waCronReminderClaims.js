/**
 * Atomic per-document claims for WhatsApp reminder crons (avoid duplicate sends under overlapping workers).
 */

function claimTtlMs() {
  return Math.max(30000, parseInt(process.env.WA_CRON_CLAIM_TTL_MS || '120000', 10) || 120000);
}

/**
 * @param {import('mongoose').Model} FormSubmission
 * @param {object} baseFilter Mongo filter (must include slot window + unsent flag)
 * @param {string} claimField e.g. 'waPre4hrCronClaimUntil'
 * @param {number} [maxBatch]
 */
async function claimSubmissionsForCronJob(FormSubmission, baseFilter, claimField, maxBatch = 2000) {
  const now = new Date();
  const until = new Date(now.getTime() + claimTtlMs());
  const claimed = [];
  const claimOr = {
    $or: [
      { [claimField]: null },
      { [claimField]: { $exists: false } },
      { [claimField]: { $lt: now } }
    ]
  };
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const doc = await FormSubmission.findOneAndUpdate(
      { ...baseFilter, ...claimOr },
      { $set: { [claimField]: until } },
      { sort: { 'step3Data.slotDate': 1 }, new: true }
    ).lean();
    if (!doc) break;
    claimed.push(doc);
    if (claimed.length >= maxBatch) break;
  }
  return claimed;
}

async function clearCronClaimForPhone(FormSubmission, phone, claimField) {
  await FormSubmission.updateOne({ phone }, { $unset: { [claimField]: '' } });
}

async function clearCronClaimsForPhones(FormSubmission, phones, claimField) {
  if (!phones || !phones.length) return;
  await FormSubmission.updateMany({ phone: { $in: phones } }, { $unset: { [claimField]: '' } });
}

module.exports = {
  claimSubmissionsForCronJob,
  clearCronClaimForPhone,
  clearCronClaimsForPhones
};
