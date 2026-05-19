/**
 * Resolve WhatsAppMessageEvent rows for inbound Gupshup DLR webhooks.
 */
const { GUIDEXPERT_EVENT_MATCH_FRAGMENT } = require('./whatsappOpsProduct');

const IN_FLIGHT_MATCH_STATUSES = Object.freeze([
  'queued',
  'submitted',
  'sent',
  'retry_pending',
  'awaiting_final_dlr'
]);

/** Phone fallback also targets send-time `failed` rows recoverable via late Meta DLR. */
const DLR_PHONE_FALLBACK_STATUSES = Object.freeze([...IN_FLIGHT_MATCH_STATUSES, 'failed']);

function phoneFallbackWindowHours() {
  return Math.min(
    Math.max(parseInt(process.env.WA_WEBHOOK_PHONE_FALLBACK_HOURS || '', 10) || 48, 1),
    168
  );
}

function statusPickScore(status) {
  const s = String(status || '').toLowerCase();
  const table = {
    failed: 2,
    queued: 1,
    retry_pending: 2,
    submitted: 3,
    awaiting_final_dlr: 4,
    sent: 5
  };
  return table[s] || 0;
}

function isDlrFallbackEligibleStatus(status) {
  return DLR_PHONE_FALLBACK_STATUSES.includes(String(status || '').toLowerCase());
}

/**
 * When multiple events share a provider id, pick the best in-flight candidate.
 * @param {Array<object>} docs
 * @returns {object|null}
 */
function pickBestWebhookMatchCandidate(docs) {
  if (!docs || docs.length === 0) return null;
  if (docs.length === 1) return docs[0];

  const ranked = [...docs].sort((a, b) => {
    const aInFlight = isDlrFallbackEligibleStatus(a.status) ? 1 : 0;
    const bInFlight = isDlrFallbackEligibleStatus(b.status) ? 1 : 0;
    if (bInFlight !== aInFlight) return bInFlight - aInFlight;

    const aIit = a.opsProduct === 'iit_counselling' ? 1 : 0;
    const bIit = b.opsProduct === 'iit_counselling' ? 1 : 0;
    if (bIit !== aIit) return bIit - aIit;

    const statusDiff = statusPickScore(b.status) - statusPickScore(a.status);
    if (statusDiff !== 0) return statusDiff;

    const aProv = a.providerAcceptedAt ? new Date(a.providerAcceptedAt).getTime() : 0;
    const bProv = b.providerAcceptedAt ? new Date(b.providerAcceptedAt).getTime() : 0;
    if (bProv !== aProv) return bProv - aProv;

    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });

  return ranked[0] || null;
}

/**
 * Scoped phone fallback when provider id match finds no rows.
 * @param {string} phone10
 * @param {Date} receivedAt
 * @param {{ opsProduct?: 'guidexpert'|'iit_counselling'|null, messageKind?: string|null }} [opts]
 */
function buildPhoneFallbackMatchQuery(phone10, receivedAt, opts = {}) {
  const hours = phoneFallbackWindowHours();
  const since = new Date(receivedAt.getTime() - hours * 60 * 60 * 1000);
  const q = {
    phone: phone10,
    status: { $in: DLR_PHONE_FALLBACK_STATUSES },
    deliveredAt: null,
    readAt: null,
    createdAt: { $gte: since, $lte: receivedAt }
  };
  if (opts.messageKind) q.messageKind = opts.messageKind;
  if (opts.opsProduct === 'iit_counselling') {
    q.opsProduct = 'iit_counselling';
  } else if (opts.opsProduct === 'guidexpert') {
    Object.assign(q, GUIDEXPERT_EVENT_MATCH_FRAGMENT);
  }
  return q;
}

/**
 * Infer ops product for phone fallback from webhook template env keys in payload snippet.
 * @param {string|null|undefined} rawPayloadSnippet
 */
function inferOpsProductFromWebhookSnippet(rawPayloadSnippet) {
  const s = String(rawPayloadSnippet || '');
  if (/GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED|iit_counselling|iitcounselling/i.test(s)) {
    return 'iit_counselling';
  }
  return null;
}

module.exports = {
  IN_FLIGHT_MATCH_STATUSES,
  DLR_PHONE_FALLBACK_STATUSES,
  phoneFallbackWindowHours,
  pickBestWebhookMatchCandidate,
  buildPhoneFallbackMatchQuery,
  inferOpsProductFromWebhookSnippet
};
