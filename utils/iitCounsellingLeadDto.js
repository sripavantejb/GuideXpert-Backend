function pickUtmFromSources(sub, visit) {
  const pick = (...vals) => {
    for (const v of vals) {
      const s = typeof v === 'string' ? v.trim() : '';
      if (s) return s;
    }
    return '';
  };
  return {
    utm_source: pick(visit?.utm_source, sub?.utm_source),
    utm_medium: pick(visit?.utm_medium, sub?.utm_medium),
    utm_campaign: pick(visit?.utm_campaign, sub?.utm_campaign),
    utm_content: pick(visit?.utm_content, sub?.utm_content),
  };
}

function mapIitCounsellingLeadToDTO(sub, visit) {
  const iit = sub.iitCounselling || {};
  const utm = pickUtmFromSources(sub, visit);
  const studentName = sub.fullName || iit.section1Data?.fullName || '';
  const phone = sub.phone || iit.section1Data?.mobileNumber || '';
  const slotBooking = iit.section1Data?.slotBooking || '';
  const slotBookingDate = iit.section1Data?.slotBookingDate || null;

  return {
    id: sub._id,
    fullName: studentName,
    phone,
    currentStep: iit.currentStep || sub.currentStep || 1,
    isCompleted: !!iit.isCompleted || !!sub.isCompleted,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
    section1Data: iit.section1Data || null,
    section2Data: iit.section2Data || null,
    section3Data: iit.section3Data || null,
    slotBooking,
    slotBookingDate,
    counsellingSlotInstantUtc: sub.counsellingSlotInstantUtc || null,
    utm,
    assignedBdaId: sub.assignedBdaId || null,
    assignedBdaName: sub.assignedBdaName || '',
    assignedAt: sub.assignedAt || null,
    assignedBy: sub.assignedBy || '',
    assignedByAdminId: sub.assignedByAdminId || null,
    assignedByAdminName: sub.assignedByAdminName || '',
    callStatus: sub.callStatus || 'not_called',
    leadStatus: sub.leadStatus || null,
    demoStatus: sub.demoStatus || 'not_scheduled',
    niatStatus: sub.niatStatus || 'not_registered',
    niatRegistrationStatus: sub.niatStatus || 'not_registered',
    paymentStatus: sub.paymentStatus || 'not_paid',
    callbackNeeded: !!sub.callbackNeeded,
    callbackDate: sub.callbackDate || sub.callbackDateTime || null,
    callbackDateTime: sub.callbackDateTime || sub.callbackDate || null,
    callbackNote: sub.callbackNote || '',
    lastRemark: sub.lastRemark || sub.latestRemark || '',
    latestRemark: sub.latestRemark || sub.lastRemark || '',
    lastUpdatedBy: sub.lastUpdatedBy || '',
    lastUpdatedByRole: sub.lastUpdatedByRole || '',
    lastUpdatedAt: sub.lastUpdatedAt || sub.crmUpdatedAt || null,
    lastActivityAt: sub.lastActivityAt || null,
    crmUpdatedAt: sub.crmUpdatedAt || null,
    parentName: iit.section1Data?.parentName || '',
    city: iit.section1Data?.city || iit.section1Data?.location || '',
    alternatePhone: iit.section1Data?.alternateMobile || iit.section1Data?.alternatePhone || '',
    preferredLanguage: iit.section2Data?.preferredLanguage || '',
  };
}

const IIT_SUB_DEDUP_PHONE_ADD_FIELDS = {
  $addFields: {
    phoneKey: { $trim: { input: { $ifNull: ['$phone', ''] } } },
    _demoSortKey: {
      $let: {
        vars: {
          d: { $trim: { input: { $ifNull: ['$iitCounselling.section1Data.slotBookingDate', ''] } } },
        },
        in: {
          $cond: [
            {
              $regexMatch: {
                input: '$$d',
                regex: '^\\d{4}-\\d{2}-\\d{2}$',
              },
            },
            '$$d',
            '0000-01-01',
          ],
        },
      },
    },
  },
};

module.exports = {
  mapIitCounsellingLeadToDTO,
  IIT_SUB_DEDUP_PHONE_ADD_FIELDS,
};
