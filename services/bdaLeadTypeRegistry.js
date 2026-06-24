const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const FormSubmission = require('../models/FormSubmission');
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const {
  BDA_LEAD_TYPES,
  BDA_LEAD_TYPE_LABELS,
  isValidBdaLeadType,
} = require('../constants/bdaLeadTypes');
const { mapIitCounsellingLeadToDTO } = require('../utils/iitCounsellingLeadDto');
const {
  mapCounsellorLeadToBdaDto,
  mapOneOnOneLeadToBdaDto,
} = require('../utils/bdaLeadDto');

const REGISTRY = {
  iit_counselling: {
    label: BDA_LEAD_TYPE_LABELS.iit_counselling,
    model: IitCounsellingSubmission,
    ownershipFilter: { submissionType: 'iitCounselling' },
    mapToDto: (doc, visit) => ({
      ...mapIitCounsellingLeadToDTO(doc, visit),
      leadType: 'iit_counselling',
      leadTypeLabel: BDA_LEAD_TYPE_LABELS.iit_counselling,
    }),
    getDisplayName: (lead) => lead.fullName || '',
    getPhone: (lead) => lead.phone || '',
    supportsIitMeetFilters: true,
  },
  counsellor: {
    label: BDA_LEAD_TYPE_LABELS.counsellor,
    model: FormSubmission,
    ownershipFilter: { submissionType: 'general' },
    mapToDto: (doc) => mapCounsellorLeadToBdaDto(doc),
    getDisplayName: (lead) => lead.fullName || lead.step1Data?.fullName || '',
    getPhone: (lead) => lead.phone || lead.step1Data?.whatsappNumber || '',
    supportsIitMeetFilters: false,
  },
  one_on_one: {
    label: BDA_LEAD_TYPE_LABELS.one_on_one,
    model: OneOnOneCounselingLead,
    ownershipFilter: {},
    mapToDto: (doc) => mapOneOnOneLeadToBdaDto(doc),
    getDisplayName: (lead) => lead.studentName || '',
    getPhone: (lead) => lead.mobileNumber || '',
    supportsIitMeetFilters: false,
  },
};

function getLeadTypeConfig(leadType) {
  if (!isValidBdaLeadType(leadType)) return null;
  return REGISTRY[leadType];
}

function listLeadTypeOptions() {
  return BDA_LEAD_TYPES.map((id) => ({ id, label: REGISTRY[id].label }));
}

async function findLeadByTypeAndId(leadType, leadId) {
  const config = getLeadTypeConfig(leadType);
  if (!config) return null;
  return config.model.findOne({ _id: leadId, ...config.ownershipFilter });
}

async function findOwnedLeadForBda(leadType, leadId, bdaId) {
  const config = getLeadTypeConfig(leadType);
  if (!config) return null;
  return config.model.findOne({
    _id: leadId,
    ...config.ownershipFilter,
    assignedBdaId: bdaId,
  });
}

function clearAssignmentFields() {
  return {
    assignedBdaId: null,
    assignedBdaName: '',
    assignedAt: null,
    assignedBy: '',
    assignedByAdminId: null,
    assignedByAdminName: '',
  };
}

module.exports = {
  REGISTRY,
  getLeadTypeConfig,
  listLeadTypeOptions,
  findLeadByTypeAndId,
  findOwnedLeadForBda,
  clearAssignmentFields,
};
