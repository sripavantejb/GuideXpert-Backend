/**
 * Google Meet links for guidance session counsellors (keyed by name tokens).
 */
const GUIDANCE_COUNSELOR_MEET_LINKS = [
  { keys: ['vedansh'], url: 'https://meet.google.com/dhg-mcvj-rac' },
  { keys: ['divya'], url: 'https://meet.google.com/oaq-uqzi-vwf' },
  { keys: ['avijith', 'avijit'], url: 'https://meet.google.com/hak-qjso-rmp' },
  { keys: ['moin'], url: 'https://meet.google.com/nsa-yhwa-jsy' },
  { keys: ['vinod'], url: 'https://meet.google.com/rgk-pwrg-jze' },
  { keys: ['lahari'], url: 'https://meet.google.com/rtu-xffz-kqa' },
  { keys: ['manisha', 'maneesha'], url: 'https://meet.google.com/yuk-qwui-fse' },
  { keys: ['ganesh'], url: 'https://meet.google.com/obx-kead-ywb' },
];

function normalizeCounselorName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} counselorName
 * @returns {string|null}
 */
function resolveGuidanceCounselorMeetLink(counselorName) {
  const normalized = normalizeCounselorName(counselorName);
  if (!normalized) return null;

  for (const entry of GUIDANCE_COUNSELOR_MEET_LINKS) {
    if (entry.keys.some((key) => normalized.includes(key))) {
      return entry.url;
    }
  }
  return null;
}

/**
 * @param {string[]} counselorNames
 * @returns {string[]}
 */
function listCounselorsWithoutMeetLinks(counselorNames) {
  return [...new Set(counselorNames.map((n) => String(n || '').trim()).filter(Boolean))].filter(
    (name) => !resolveGuidanceCounselorMeetLink(name)
  );
}

module.exports = {
  GUIDANCE_COUNSELOR_MEET_LINKS,
  normalizeCounselorName,
  resolveGuidanceCounselorMeetLink,
  listCounselorsWithoutMeetLinks,
};
