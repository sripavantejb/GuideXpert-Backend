/**
 * Guidance counsellor WhatsApp numbers (fallback when OneOnOneCounselor.mobile is unset).
 */
const { normalizeCounselorName } = require('./guidanceCounselorMeetLinks');

const GUIDANCE_COUNSELOR_PHONE_FALLBACKS = [
  { keys: ['avijith', 'avijit'], phone: '7531813055' },
  { keys: ['ganesh'], phone: '9840914311' },
  { keys: ['jayanth'], phone: '8008277057' },
  { keys: ['lahari'], phone: '9182693977' },
  { keys: ['manisha', 'maneesha'], phone: '9640391004' },
  { keys: ['moin'], phone: '9536388198' },
  { keys: ['divya'], phone: '9599697281' },
  { keys: ['vedansh'], phone: '9935432605' },
  { keys: ['vinod'], phone: '6304153659' },
];

/**
 * @param {string} counselorName
 * @returns {string|null}
 */
function resolveGuidanceCounselorPhoneFallback10(counselorName) {
  const normalized = normalizeCounselorName(counselorName);
  if (!normalized) return null;

  for (const entry of GUIDANCE_COUNSELOR_PHONE_FALLBACKS) {
    if (entry.keys.some((key) => normalized.includes(key))) {
      return entry.phone;
    }
  }
  return null;
}

/**
 * DB mobile first; name-based fallback from GUIDANCE_COUNSELOR_PHONE_FALLBACKS.
 * @param {{ mobile?: string, name?: string }|null|undefined} counselor
 * @returns {string|null}
 */
function resolveGuidanceCounselorPhone10(counselor) {
  const mobile = String(counselor?.mobile || '').trim();
  if (/^\d{10}$/.test(mobile)) {
    return mobile;
  }
  return resolveGuidanceCounselorPhoneFallback10(counselor?.name);
}

module.exports = {
  GUIDANCE_COUNSELOR_PHONE_FALLBACKS,
  resolveGuidanceCounselorPhoneFallback10,
  resolveGuidanceCounselorPhone10,
};
