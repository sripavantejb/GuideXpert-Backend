const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const GuidanceSlot = require('../models/GuidanceSlot');
const OneOnOneCounselor = require('../models/OneOnOneCounselor');
const {
  resolveGuidanceCounselorMeetLink,
  listCounselorsWithoutMeetLinks,
} = require('../constants/guidanceCounselorMeetLinks');
const { isWithinGuidanceSlotWindow } = require('../utils/guidanceSlotTimeWindow');

async function getActiveCounselorsMissingMeetLinks() {
  const counselors = await OneOnOneCounselor.find({ isActive: true }).select('name').sort({ name: 1 }).lean();
  return listCounselorsWithoutMeetLinks(counselors.map((c) => c.name));
}

function resolveMeetLinkForBooking(counselorName, sessionTitle) {
  return (
    resolveGuidanceCounselorMeetLink(counselorName) ||
    resolveGuidanceCounselorMeetLink(sessionTitle)
  );
}

/**
 * @param {string} mobileNumber 10-digit mobile
 * @param {Date} [now]
 * @returns {Promise<{ error: string, status: number, data?: object }|{ data: object }>}
 */
async function joinGuidanceMeetForMobile(mobileNumber, now = new Date()) {
  const lead = await OneOnOneCounselingLead.findOne({
    mobileNumber,
    bookingConfirmed: true,
  });

  if (!lead) {
    return {
      error: 'No confirmed booking found for this mobile number.',
      status: 404,
    };
  }

  if (!lead.selectedSlotId) {
    return {
      error: 'Your booking does not have a session slot assigned.',
      status: 404,
    };
  }

  const [slot, counselor] = await Promise.all([
    GuidanceSlot.findById(lead.selectedSlotId).lean(),
    lead.oneOnOneCounselorId
      ? OneOnOneCounselor.findById(lead.oneOnOneCounselorId).select('name collegeName isActive').lean()
      : null,
  ]);

  if (!slot) {
    return {
      error: 'Your booked session slot could not be found.',
      status: 404,
    };
  }

  if (!counselor || counselor.isActive === false) {
    return {
      error: 'Your assigned counsellor is not available.',
      status: 404,
    };
  }

  const windowCheck = isWithinGuidanceSlotWindow(slot, now);
  if (!windowCheck.allowed) {
    return {
      error: windowCheck.reason || 'You cannot join outside your session time.',
      status: 403,
      data: {
        slot: {
          sessionTitle: slot.sessionTitle,
          slotDate: slot.slotDate,
          slotTime: slot.slotTime,
        },
        counselor: { name: counselor.name, collegeName: counselor.collegeName || '' },
      },
    };
  }

  const meetLink = resolveMeetLinkForBooking(counselor.name, slot.sessionTitle);
  if (!meetLink) {
    const counselorsWithoutMeetLink = await getActiveCounselorsMissingMeetLinks();
    return {
      error: `Meet link is not configured for counsellor "${counselor.name}". Please contact the GuideXpert team.`,
      status: 503,
      data: {
        counselor: { name: counselor.name, collegeName: counselor.collegeName || '' },
        counselorsWithoutMeetLink,
      },
    };
  }

  lead.bookingStatus = 'Attended';
  lead.attendanceStatus = 'Attended';
  await lead.save();

  return {
    data: {
      meetLink,
      studentName: lead.studentName,
      counselor: {
        name: counselor.name,
        collegeName: counselor.collegeName || '',
      },
      slot: {
        sessionTitle: slot.sessionTitle,
        slotDate: slot.slotDate,
        slotTime: slot.slotTime,
      },
    },
  };
}

module.exports = {
  joinGuidanceMeetForMobile,
  getActiveCounselorsMissingMeetLinks,
  resolveMeetLinkForBooking,
};
