/**
 * FormSubmission campaign reminder flags — set only after WhatsApp initial send succeeds.
 */

const SENT_FLAG_BY_KIND = {
  pre4hr: { sent: 'reminderSent', sentAt: 'reminderSentAt' },
  meet: { sent: 'meetLinkSent', sentAt: 'meetLinkSentAt' },
  '30min': { sent: 'reminder30MinSent', sentAt: 'reminder30MinSentAt' }
};

/**
 * @param {import('mongoose').Model} FormSubmission
 * @param {string} phone10
 * @param {'pre4hr'|'meet'|'30min'} kind
 * @param {Date} [at]
 */
async function markCampaignSentFlag(FormSubmission, phone10, kind, at = new Date()) {
  const keys = SENT_FLAG_BY_KIND[kind];
  if (!keys || !phone10) return;
  await FormSubmission.updateOne(
    { phone: phone10 },
    { $set: { [keys.sent]: true, [keys.sentAt]: at } }
  );
}

/**
 * @param {import('mongoose').Model} FormSubmission
 * @param {string} phone10
 * @param {'pre4hr'|'meet'|'30min'} kind
 */
async function clearCampaignSentFlag(FormSubmission, phone10, kind) {
  const keys = SENT_FLAG_BY_KIND[kind];
  if (!keys || !phone10) return;
  await FormSubmission.updateOne(
    { phone: phone10 },
    { $set: { [keys.sent]: false, [keys.sentAt]: null } }
  );
}

module.exports = {
  SENT_FLAG_BY_KIND,
  markCampaignSentFlag,
  clearCampaignSentFlag
};
