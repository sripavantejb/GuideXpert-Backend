/**
 * IIT counselling reminder WhatsApp vars + template param profiles (isolated from slot_booked).
 */
const { buildSlotNotificationVariables } = require('./slotNotificationFormatters');
const { SLOT_BOOKED_IIT_PARAM_KEYS, PRE4HR_PARAM_KEYS, buildParamsFromKeys } = require('./gupshupWhatsAppTemplateParams');
const { isIitReminderMessageKind } = require('./iitCounsellingWhatsApp');

const DEFAULT_PRE2HR_PROFILES = [
  ['name'],
  [],
  ['name', 'date', 'time'],
];

function timeFromSlotBookingLabel(slotBooking) {
  const label = String(slotBooking || '').trim();
  if (!label) return '';
  if (/11\s*AM/i.test(label)) return '11:00 AM';
  if (/6\s*PM/i.test(label)) return '6:00 PM';
  if (/3\s*PM/i.test(label)) return '3:00 PM';
  if (/7\s*PM/i.test(label)) return '7:00 PM';
  return '';
}

function sanitizeReminderName(raw) {
  const s = String(raw || 'Student')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s.'-]/gu, '')
    .slice(0, 60);
  return s || 'Student';
}

/**
 * @param {object} iitSub lean IitCounsellingSubmission
 */
function buildIitReminderWhatsAppVars(iitSub) {
  const iit = iitSub?.iitCounselling || {};
  const section1 = iit.section1Data || {};
  const slotUtc = iitSub?.counsellingSlotInstantUtc;
  const slotBooking = typeof section1.slotBooking === 'string' ? section1.slotBooking.trim() : '';
  const slotId = section1.selectedSlot || section1.slotId || slotBooking || '';
  const base = buildSlotNotificationVariables({
    fullName: sanitizeReminderName(iitSub?.fullName || section1.fullName),
    step3Data: {
      slotDate: slotUtc,
      selectedSlot: slotId,
    },
  });
  const parsed = timeFromSlotBookingLabel(slotBooking || base.time);
  if (parsed) {
    base.time = parsed;
  }
  return base;
}

function parseParamProfileEnv(raw, fallbackProfiles) {
  if (raw == null || String(raw).trim() === '') return fallbackProfiles;
  const profiles = String(raw)
    .split('|')
    .map((segment) => {
      const t = segment.trim();
      if (t === '' || t.toLowerCase() === 'none') return [];
      return t
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
    });
  return profiles.length ? profiles : fallbackProfiles;
}

/**
 * Ordered Gupshup body param keys per reminder kind and attempt (1-based).
 * @param {string} messageKind
 * @param {number} attemptNumber
 */
function paramKeysForIitReminder(messageKind, attemptNumber = 1) {
  if (!isIitReminderMessageKind(messageKind)) {
    return [...SLOT_BOOKED_IIT_PARAM_KEYS];
  }

  if (messageKind === 'iit_pre2hr') {
    const profiles = parseParamProfileEnv(
      process.env.GUPSHUP_IIT_PRE2HR_PARAM_PROFILES,
      DEFAULT_PRE2HR_PROFILES
    );
    const idx = Math.min(profiles.length - 1, Math.max(0, attemptNumber - 1));
    return profiles[idx];
  }

  const envKey = `GUPSHUP_IIT_${String(messageKind).toUpperCase()}_PARAM_KEYS`;
  const raw = process.env[envKey];
  if (raw != null && String(raw).trim() !== '') {
    if (String(raw).trim().toLowerCase() === 'none') return [];
    return String(raw)
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
  }

  return [...SLOT_BOOKED_IIT_PARAM_KEYS];
}

function buildIitReminderTemplateParams(vars, messageKind, attemptNumber = 1) {
  const keys = paramKeysForIitReminder(messageKind, attemptNumber);
  return buildParamsFromKeys(vars, keys);
}

function isTemplateParamFormatError(failCtx = {}) {
  const hay = [failCtx.errorCode, failCtx.errorReason, failCtx.errorText, failCtx.errorMessage]
    .filter(Boolean)
    .join(' | ');
  return /132012/i.test(hay) || /parameter format does not match/i.test(hay);
}

module.exports = {
  sanitizeReminderName,
  buildIitReminderWhatsAppVars,
  paramKeysForIitReminder,
  buildIitReminderTemplateParams,
  parseParamProfileEnv,
  isTemplateParamFormatError,
  DEFAULT_PRE2HR_PROFILES,
  PRE4HR_PARAM_KEYS,
};
