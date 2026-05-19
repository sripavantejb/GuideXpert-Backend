/**
 * IIT counselling Gupshup template env resolution (slot_booked + language-aware reminders).
 */

const IIT_BOOKING_LABEL_TO_TEMPLATE_ENV_KEY = {
  'Wednesday 6PM': 'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_WEDNESDAY',
  'Saturday 6PM': 'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SATURDAY',
  'Sunday 11AM': 'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_SUNDAY',
};

const IIT_SLOT_BOOKED_TEMPLATE_ENV_LEGACY = 'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED';
const GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL = 'GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL';

const IIT_REMINDER_KINDS = ['iit_pre2hr', 'iit_pre45min', 'iit_pre15min'];
const IIT_PREFERRED_LANGUAGES = ['Telugu', 'Hindi'];
const IIT_SUNDAY_SLOT_BOOKING = 'Sunday 11AM';

/** Wed/Sat vs Sunday reminder template env key names. */
const IIT_REMINDER_TEMPLATE_ENV = {
  weekday: {
    iit_pre2hr: {
      Telugu: 'GUPSHUP_TEMPLATE_IIT_PRE2HR_TELUGU',
      Hindi: 'GUPSHUP_TEMPLATE_IIT_PRE2HR_HINDI',
    },
    iit_pre45min: {
      Telugu: 'GUPSHUP_TEMPLATE_IIT_PRE45MIN_TELUGU',
      Hindi: 'GUPSHUP_TEMPLATE_IIT_PRE45MIN_HINDI',
    },
    iit_pre15min: {
      Telugu: 'GUPSHUP_TEMPLATE_IIT_PRE15MIN_TELUGU',
      Hindi: 'GUPSHUP_TEMPLATE_IIT_PRE15MIN_HINDI',
    },
  },
  sunday: {
    iit_pre2hr: {
      Telugu: 'GUPSHUP_TEMPLATE_IIT_SUNDAY_PRE2HR_TELUGU',
      Hindi: 'GUPSHUP_TEMPLATE_IIT_SUNDAY_PRE2HR_HINDI',
    },
    iit_pre45min: {
      Telugu: 'GUPSHUP_TEMPLATE_IIT_SUNDAY_PRE45MIN_TELUGU',
      Hindi: 'GUPSHUP_TEMPLATE_IIT_SUNDAY_PRE45MIN_HINDI',
    },
    iit_pre15min: {
      Telugu: 'GUPSHUP_TEMPLATE_IIT_SUNDAY_PRE15MIN_TELUGU',
      Hindi: 'GUPSHUP_TEMPLATE_IIT_SUNDAY_PRE15MIN_HINDI',
    },
  },
};

const IIT_SLOT_BOOKED_TEMPLATE_ENV_KEYS = new Set([
  ...Object.values(IIT_BOOKING_LABEL_TO_TEMPLATE_ENV_KEY),
  IIT_SLOT_BOOKED_TEMPLATE_ENV_LEGACY,
]);

const IIT_REMINDER_TEMPLATE_ENV_KEYS = new Set(
  Object.values(IIT_REMINDER_TEMPLATE_ENV.weekday).flatMap((byLang) => Object.values(byLang)).concat(
    Object.values(IIT_REMINDER_TEMPLATE_ENV.sunday).flatMap((byLang) => Object.values(byLang))
  )
);

function isSundaySlotBooking(slotBookingTrimmed) {
  return String(slotBookingTrimmed || '').trim() === IIT_SUNDAY_SLOT_BOOKING;
}

function isIitSlotBookedTemplateEnvKey(envKey) {
  const k = typeof envKey === 'string' ? envKey.trim() : '';
  return k.length > 0 && IIT_SLOT_BOOKED_TEMPLATE_ENV_KEYS.has(k);
}

function isIitReminderTemplateEnvKey(envKey) {
  const k = typeof envKey === 'string' ? envKey.trim() : '';
  return k.length > 0 && IIT_REMINDER_TEMPLATE_ENV_KEYS.has(k);
}

function isIitReminderMessageKind(kind) {
  return IIT_REMINDER_KINDS.includes(kind);
}

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

/**
 * @param {{ slotBooking: string, preferredLanguage: string, reminderKind: string }} opts
 * @returns {string|null} process.env key name
 */
function resolveIitReminderTemplateEnvKey({ slotBooking, preferredLanguage, reminderKind }) {
  const label = typeof slotBooking === 'string' ? slotBooking.trim() : '';
  const lang = typeof preferredLanguage === 'string' ? preferredLanguage.trim() : '';
  const kind = typeof reminderKind === 'string' ? reminderKind.trim() : '';
  if (!IIT_REMINDER_KINDS.includes(kind)) return null;
  if (!IIT_PREFERRED_LANGUAGES.includes(lang)) return null;
  if (!IIT_BOOKING_LABEL_TO_TEMPLATE_ENV_KEY[label]) return null;

  const group = isSundaySlotBooking(label) ? 'sunday' : 'weekday';
  const envKey = IIT_REMINDER_TEMPLATE_ENV[group]?.[kind]?.[lang];
  if (envKey && process.env[envKey]) {
    return envKey;
  }
  return null;
}

function resolveIitSlotBookedHeaderImageUrl() {
  const raw = process.env[GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL];
  const url = typeof raw === 'string' ? raw.trim() : '';
  if (!url || !/^https:\/\//i.test(url)) {
    return null;
  }
  return url;
}

module.exports = {
  IIT_BOOKING_LABEL_TO_TEMPLATE_ENV_KEY,
  IIT_SLOT_BOOKED_TEMPLATE_ENV_LEGACY,
  IIT_SLOT_BOOKED_TEMPLATE_ENV_KEYS,
  IIT_REMINDER_KINDS,
  IIT_PREFERRED_LANGUAGES,
  IIT_SUNDAY_SLOT_BOOKING,
  IIT_REMINDER_TEMPLATE_ENV,
  IIT_REMINDER_TEMPLATE_ENV_KEYS,
  GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL,
  isSundaySlotBooking,
  isIitSlotBookedTemplateEnvKey,
  isIitReminderTemplateEnvKey,
  isIitReminderMessageKind,
  resolveIitSlotBookedTemplateEnvKey,
  resolveIitReminderTemplateEnvKey,
  resolveIitSlotBookedHeaderImageUrl,
};
