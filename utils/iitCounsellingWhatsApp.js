/**
 * IIT counselling slot-book confirmation uses distinct Gupshup templates per booked slot label.
 * Env values are IDs; keys are resolved here before safeSendWhatsApp.
 */

const IIT_BOOKING_LABEL_TO_TEMPLATE_ENV_KEY = {
  'Wednesday 6PM': 'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_WEDNESDAY',
  'Saturday 6PM': 'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SATURDAY',
  'Sunday 11AM': 'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SUNDAY',
};

/** Legacy single-template override when per-day env is unset */
const IIT_SLOT_BOOKED_TEMPLATE_ENV_LEGACY = 'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED';

/** Env key names for IIT slot_booked templates (single body var: name only). */
const IIT_SLOT_BOOKED_TEMPLATE_ENV_KEYS = new Set([
  ...Object.values(IIT_BOOKING_LABEL_TO_TEMPLATE_ENV_KEY),
  IIT_SLOT_BOOKED_TEMPLATE_ENV_LEGACY,
]);

/** @param {string|null|undefined} envKey process.env key passed as sendOpts.templateEnvKey */
function isIitSlotBookedTemplateEnvKey(envKey) {
  const k = typeof envKey === 'string' ? envKey.trim() : '';
  return k.length > 0 && IIT_SLOT_BOOKED_TEMPLATE_ENV_KEYS.has(k);
}

/**
 * Resolve which process.env **key name** backs the IIT slot_booked Gupshup template for this booking.
 *
 * @param {string} slotBookingTrimmed Validated IIT slotBooking (e.g. "Wednesday 6PM")
 * @returns {string|null} Env key name to pass as explicitTemplateEnvKey, or null if no template configured
 */
function resolveIitSlotBookedTemplateEnvKey(slotBookingTrimmed) {
  const label = typeof slotBookingTrimmed === 'string' ? slotBookingTrimmed.trim() : '';
  const primary = IIT_BOOKING_LABEL_TO_TEMPLATE_ENV_KEY[label];
  if (primary && process.env[primary]) {
    return primary;
  }
  if (process.env[IIT_SLOT_BOOKED_TEMPLATE_ENV_LEGACY]) {
    return IIT_SLOT_BOOKED_TEMPLATE_ENV_LEGACY;
  }
  return null;
}

module.exports = {
  IIT_BOOKING_LABEL_TO_TEMPLATE_ENV_KEY,
  IIT_SLOT_BOOKED_TEMPLATE_ENV_LEGACY,
  IIT_SLOT_BOOKED_TEMPLATE_ENV_KEYS,
  isIitSlotBookedTemplateEnvKey,
  resolveIitSlotBookedTemplateEnvKey,
};
