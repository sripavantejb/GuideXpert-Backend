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

function strOrNull(v) {
  if (v == null) return null;
  const s = typeof v === 'string' ? v.trim() : String(v).trim();
  return s || null;
}

/**
 * Full IIT form snapshot for OSVI additional_data (snake_case keys).
 * @param {object} submission lean IitCounsellingSubmission
 */
function mapSubmissionToFormSnapshot(submission) {
  const iit = submission?.iitCounselling || {};
  const s1 = iit.section1Data || {};
  const s2 = iit.section2Data || {};
  const s3 = iit.section3Data || {};
  const slotInstant = submission?.counsellingSlotInstantUtc || null;
  const top5 = Array.isArray(s1.top5Colleges)
    ? s1.top5Colleges.filter(Boolean).map((c) => String(c).trim()).filter(Boolean)
    : [];

  return {
    source: 'iitian_career_counselling',
    student_name: strOrNull(submission?.fullName || s1.fullName),
    phone: strOrNull(submission?.phone || s1.mobileNumber),
    student_or_parent: strOrNull(s1.studentOrParent),
    occupation: strOrNull(submission?.occupation),
    class: strOrNull(s1.classStatus),
    stream: strOrNull(s1.stream),
    city: strOrNull(s1.city),
    parent_name: null,
    email: null,
    school: null,
    slot_booking: strOrNull(s1.slotBooking),
    slot_booking_date: strOrNull(s1.slotBookingDate),
    selected_slot: formatSelectedSlotLabel(s1.slotBooking, s1.slotBookingDate, slotInstant),
    counselling_session_at: slotInstant instanceof Date && !Number.isNaN(slotInstant.getTime())
      ? slotInstant.toISOString()
      : null,
    slot_day_ist: slotInstant ? slotDayIstFromInstant(slotInstant) : null,
    top5_colleges: top5.length ? top5 : null,
    top5_colleges_text: top5.length ? top5.join(', ') : null,
    career_decision_clarity: strOrNull(s2.careerDecisionClarity),
    college_decision_stakeholder: strOrNull(s2.collegeDecisionStakeholder),
    expected_budget: strOrNull(s2.expectedBudget),
    top_college_priority: strOrNull(s2.topCollegePriority),
    preferred_language: strOrNull(s2.preferredLanguage),
    help_needed: strOrNull(s3.helpNeeded),
    wants_one_to_one_session: strOrNull(s3.wantsOneToOneSession),
    biggest_concern: strOrNull(s3.biggestConfusion),
    career_goal: strOrNull(s3.helpNeeded || s2.careerDecisionClarity),
    form_step: submission?.currentStep ?? iit.currentStep ?? null,
    form_completed: Boolean(submission?.isCompleted ?? iit.isCompleted),
    application_status: strOrNull(submission?.applicationStatus),
  };
}

/**
 * Map IitCounsellingSubmission lean doc to reminder DB fields.
 * @param {object} submission
 * @returns {object}
 */
function mapSubmissionToReminderFields(submission) {
  const snap = mapSubmissionToFormSnapshot(submission);
  const slotInstant = submission?.counsellingSlotInstantUtc || null;

  return {
    studentName: snap.student_name || '',
    parentName: snap.parent_name,
    phone: snap.phone || '',
    email: snap.email,
    class: snap.class,
    city: snap.city,
    school: snap.school,
    biggestConcern: snap.biggest_concern,
    careerGoal: snap.career_goal,
    additionalNotes: null,
    selectedSlot: snap.selected_slot || '',
    selectedSlotInstantUtc: slotInstant,
    slotDayIst: snap.slot_day_ist,
    formSnapshot: snap,
  };
}

module.exports = {
  formatSelectedSlotLabel,
  mapSubmissionToFormSnapshot,
  mapSubmissionToReminderFields,
};
