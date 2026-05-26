/**
 * Shared Mongo match builders for WhatsApp ops (unresolved, manual recovery preview).
 */
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const { parseOpsProductQuery, matchWhatsAppEventsByOpsProduct } = require('./whatsappOpsProduct');

const GX_ONLY_KINDS = ['pre4hr', 'meet', '30min'];
const IIT_ONLY_KINDS = ['iit_pre2hr', 'iit_pre45min', 'iit_pre15min'];

function validateMessageKindForOpsProduct(messageKind, opsProduct) {
  if (!messageKind) return null;
  const slug = parseOpsProductQuery(opsProduct);
  if (slug === 'iit_counselling' && GX_ONLY_KINDS.includes(messageKind)) {
    return 'This template is GuideXpert-only. Switch product or pick an IIT template.';
  }
  if (slug === 'guidexpert' && IIT_ONLY_KINDS.includes(messageKind)) {
    return 'This template is IIT-only. Switch to IIT Counselling product.';
  }
  return null;
}

/**
 * @returns {Promise<{ match: object, empty: boolean, error?: string }>}
 */
async function buildOpsScopedEventMatch({ messageKind = null, opsProduct = null, preferredLanguage = null } = {}) {
  const kindErr = messageKind ? validateMessageKindForOpsProduct(messageKind, opsProduct) : null;
  if (kindErr) return { match: {}, empty: true, error: kindErr };

  const slug = parseOpsProductQuery(opsProduct);
  const match = { ...matchWhatsAppEventsByOpsProduct(slug) };
  if (messageKind) match.messageKind = messageKind;

  const lang =
    preferredLanguage === 'Telugu' || preferredLanguage === 'Hindi' ? preferredLanguage : null;
  if (slug === 'iit_counselling' && lang) {
    const iitIds = await IitCounsellingSubmission.distinct('_id', {
      'iitCounselling.section2Data.preferredLanguage': lang,
    });
    if (!iitIds.length) {
      return { match, empty: true };
    }
    match.iitCounsellingSubmissionId = { $in: iitIds };
  }

  return { match, empty: false };
}

module.exports = {
  GX_ONLY_KINDS,
  IIT_ONLY_KINDS,
  validateMessageKindForOpsProduct,
  buildOpsScopedEventMatch,
};
