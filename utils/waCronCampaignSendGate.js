/**
 * Atomic FormSubmission lease before campaign cron SMS+WA.
 * Claim lists are best-effort; this gate is the hard idempotency boundary per template.
 */

const mongoose = require('mongoose');
const { mergeExprIntoFilter } = require('./waCronCampaignFilters');

const LEASE_FIELD_BY_KIND = {
  pre4hr: 'waPre4hrInitialSendLease',
  meet: 'waMeetInitialSendLease',
  '30min': 'wa30minInitialSendLease'
};

const SENT_FLAG_BY_KIND = {
  pre4hr: 'reminderSent',
  meet: 'meetLinkSent',
  '30min': 'reminder30MinSent'
};

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

function initialSendLeaseMs() {
  const n = parseInt(process.env.WA_CRON_INITIAL_SEND_LEASE_MS || '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LEASE_MS;
}

/**
 * @param {'pre4hr'|'meet'|'30min'} kind
 * @param {import('mongoose').Types.ObjectId|string} submissionId
 * @param {Date} now
 * @param {Date} slotDateMin
 * @param {Date} slotDateMax
 * @param {object|null} boundaryExpr from campaignSlotDateNotBeforeSendBoundaryExpr
 * @param {import('mongoose').Types.ObjectId|string|null} cronRunId
 */
async function tryAcquireCronCampaignInitialSendLease(FormSubmission, opts) {
  const {
    kind,
    submissionId,
    now = new Date(),
    slotDateMin,
    slotDateMax,
    boundaryExpr,
    cronRunId
  } = opts;

  const leaseKey = LEASE_FIELD_BY_KIND[kind];
  const sentKey = SENT_FLAG_BY_KIND[kind];
  if (!leaseKey || !sentKey) {
    throw new Error(`waCronCampaignSendGate: unknown kind ${kind}`);
  }

  const id = mongoose.Types.ObjectId.isValid(String(submissionId))
    ? new mongoose.Types.ObjectId(String(submissionId))
    : null;
  if (!id) return { acquired: false };

  const until = new Date(now.getTime() + initialSendLeaseMs());
  const token = cronRunId && mongoose.Types.ObjectId.isValid(String(cronRunId))
    ? String(cronRunId)
    : 'cron';

  const base = {
    _id: id,
    isRegistered: true,
    [sentKey]: { $ne: true },
    'step3Data.slotDate': {
      $gt: now,
      $gte: slotDateMin,
      $lte: slotDateMax
    },
    $or: [{ [leaseKey]: { $exists: false } }, { [`${leaseKey}.until`]: { $lt: now } }]
  };

  const filter = mergeExprIntoFilter(base, boundaryExpr);

  const doc = await FormSubmission.findOneAndUpdate(
    filter,
    { $set: { [leaseKey]: { token, until } } },
    { new: true }
  ).lean();

  return { acquired: !!doc, doc };
}

async function releaseCronCampaignInitialSendLease(FormSubmission, kind, submissionId) {
  const leaseKey = LEASE_FIELD_BY_KIND[kind];
  if (!leaseKey || !submissionId) return;
  const id = mongoose.Types.ObjectId.isValid(String(submissionId))
    ? new mongoose.Types.ObjectId(String(submissionId))
    : null;
  if (!id) return;
  await FormSubmission.updateOne({ _id: id }, { $unset: { [leaseKey]: '' } }).catch(() => {});
}

function leaseFieldForKind(kind) {
  return LEASE_FIELD_BY_KIND[kind] || null;
}

module.exports = {
  LEASE_FIELD_BY_KIND,
  tryAcquireCronCampaignInitialSendLease,
  releaseCronCampaignInitialSendLease,
  leaseFieldForKind
};
