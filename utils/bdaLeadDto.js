const { BDA_LEAD_TYPE_LABELS } = require('../constants/bdaLeadTypes');

function mapCounsellorLeadToBdaDto(doc) {
  return {
    id: String(doc._id),
    leadType: 'counsellor',
    leadTypeLabel: BDA_LEAD_TYPE_LABELS.counsellor,
    fullName: doc.fullName || doc.step1Data?.fullName || '',
    phone: doc.phone || doc.step1Data?.whatsappNumber || '',
    occupation: doc.occupation || doc.step1Data?.occupation || '',
    leadStatus: doc.leadStatus || '',
    leadDescription: doc.leadDescription || '',
    adminNotes: doc.adminNotes || '',
    applicationStatus: doc.applicationStatus || '',
    selectedSlot: doc.selectedSlot || doc.step3Data?.selectedSlot || '',
    slotDate: doc.step3Data?.slotDate || null,
    assignedBdaId: doc.assignedBdaId || null,
    assignedBdaName: doc.assignedBdaName || '',
    assignedAt: doc.assignedAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    utm_source: doc.utm_source || '',
    utm_campaign: doc.utm_campaign || '',
  };
}

function mapOneOnOneLeadToBdaDto(doc) {
  return {
    id: String(doc._id),
    leadType: 'one_on_one',
    leadTypeLabel: BDA_LEAD_TYPE_LABELS.one_on_one,
    fullName: doc.studentName || '',
    phone: doc.mobileNumber || '',
    parentName: doc.parentName || '',
    city: doc.city || '',
    currentClass: doc.currentClass || '',
    preferredLanguage: doc.preferredLanguage || '',
    leadStatus: doc.leadStatus || '',
    bookingStatus: doc.bookingStatus || '',
    counselorRemarks: doc.counselorRemarks || '',
    formCompleted: !!doc.formCompleted,
    assignedBdaId: doc.assignedBdaId || null,
    assignedBdaName: doc.assignedBdaName || '',
    assignedAt: doc.assignedAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    utm_source: doc.utm_source || '',
    utm_campaign: doc.utm_campaign || '',
  };
}

function attachLeadTypeMeta(dto, leadType) {
  if (!dto || dto.leadType) return dto;
  return {
    ...dto,
    leadType,
    leadTypeLabel: BDA_LEAD_TYPE_LABELS[leadType] || leadType,
  };
}

module.exports = {
  mapCounsellorLeadToBdaDto,
  mapOneOnOneLeadToBdaDto,
  attachLeadTypeMeta,
};
