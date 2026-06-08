const { slotDayIstFromInstant } = require('../services/whatsappOpsCohortShared');

function formatSelectedSlotLabel(slotBooking, slotBookingDate, slotInstantUtc) {
  const label = typeof slotBooking === 'string' ? slotBooking.trim() : '';
  const date = typeof slotBookingDate === 'string' ? slotBookingDate.trim() : '';
  if (label && date) return `${label}, ${date}`;
  if (label) return label;
  if (slotInstantUtc instanceof Date && !Number.isNaN(slotInstantUtc.getTime())) {
    return slotInstantUtc.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }
  return '';
}

/**
 * Map IitCounsellingSubmission lean doc to reminder fields.
 * @param {object} submission
 * @returns {object}
 */
function mapSubmissionToReminderFields(submission) {
  const iit = submission?.iitCounselling || {};
  const s1 = iit.section1Data || {};
  const s2 = iit.section2Data || {};
  const s3 = iit.section3Data || {};
  const slotInstant = submission?.counsellingSlotInstantUtc || null;

  const careerGoal =
    (typeof s3.helpNeeded === 'string' && s3.helpNeeded.trim()) ||
    (typeof s2.careerDecisionClarity === 'string' && s2.careerDecisionClarity.trim()) ||
    null;

  return {
    studentName: submission?.fullName || s1.fullName || '',
    parentName: null,
    phone: submission?.phone || s1.mobileNumber || '',
    email: null,
    class: s1.classStatus || null,
    city: s1.city || null,
    school: null,
    biggestConcern: s3.biggestConfusion || null,
    careerGoal,
    additionalNotes: null,
    selectedSlot: formatSelectedSlotLabel(s1.slotBooking, s1.slotBookingDate, slotInstant),
    selectedSlotInstantUtc: slotInstant,
    slotDayIst: slotInstant ? slotDayIstFromInstant(slotInstant) : null,
  };
}

module.exports = {
  formatSelectedSlotLabel,
  mapSubmissionToReminderFields,
};
