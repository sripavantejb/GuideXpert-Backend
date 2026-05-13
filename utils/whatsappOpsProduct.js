/**
 * Ops overview product dimension for WhatsAppMessageEvent filtering.
 * Legacy rows omit opsProduct → treated as GuideXpert.
 */

const DEFAULT_OPS_PRODUCT = 'guidexpert';
const ALLOWED_OPS_PRODUCTS = Object.freeze(['guidexpert', 'iit_counselling']);

/** @typedef {'guidexpert'|'iit_counselling'} OpsProductSlug */

/** @returns {readonly string[]} */
function listAllowedOpsProducts() {
  return ALLOWED_OPS_PRODUCTS;
}

/**
 * Parse query/header string into a normalized ops product slug.
 * Invalid values fall back to `guidexpert`.
 * @param {unknown} raw
 * @returns {'guidexpert'|'iit_counselling'}
 */
function parseOpsProductQuery(raw) {
  const s = raw == null ? '' : String(raw).trim().toLowerCase().replace(/-/g, '_');
  if (s === 'iit_counselling' || s === 'iitcounselling') return 'iit_counselling';
  return DEFAULT_OPS_PRODUCT;
}

/** For GuideXpert, include legacy docs with missing/null opsProduct. */
const GUIDEXPERT_EVENT_MATCH_FRAGMENT = Object.freeze({
  $or: [
    { opsProduct: { $exists: false } },
    { opsProduct: null },
    { opsProduct: 'guidexpert' }
  ]
});

/** @returns {object} fragment to merge into a Mongo `$match` (AND with other predicates) */
function matchWhatsAppEventsByOpsProduct(/** @type {'guidexpert'|'iit_counselling'} */ slug) {
  if (slug === 'iit_counselling') {
    return { opsProduct: 'iit_counselling' };
  }
  return { ...GUIDEXPERT_EVENT_MATCH_FRAGMENT };
}

/**
 * Persisted / outbound events: explicit IIT slug or GuideXpert default.
 * @param {unknown} raw
 * @returns {'guidexpert'|'iit_counselling'}
 */
function normalizeOutboundOpsProduct(raw) {
  if (raw === 'iit_counselling') return 'iit_counselling';
  return DEFAULT_OPS_PRODUCT;
}

/**
 * IIT Overview forces `slot_booked` cohort when caller omits template filter.
 * @param {unknown} opsProductRaw
 * @param {string|null} messageKind
 * @returns {string|null}
 */
function effectiveOverviewMessageKind(opsProductRaw, messageKind) {
  const slug = parseOpsProductQuery(opsProductRaw);
  if (slug === 'iit_counselling' && !messageKind) return 'slot_booked';
  return messageKind;
}

module.exports = {
  DEFAULT_OPS_PRODUCT,
  ALLOWED_OPS_PRODUCTS,
  listAllowedOpsProducts,
  parseOpsProductQuery,
  normalizeOutboundOpsProduct,
  effectiveOverviewMessageKind,
  matchWhatsAppEventsByOpsProduct,
  GUIDEXPERT_EVENT_MATCH_FRAGMENT
};
