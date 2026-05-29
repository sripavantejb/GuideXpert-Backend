const FormSubmission = require('../models/FormSubmission');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');

function normalizePhone10(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function formatPhoneE16491(phone10) {
  const ten = normalizePhone10(phone10);
  if (!ten) return null;
  return `91${ten}`;
}

function maskPhoneTail(phone10) {
  const d = normalizePhone10(phone10);
  if (!d || d.length < 4) return '****';
  return `****${d.slice(-4)}`;
}

/**
 * Resolve product line and lead document ids for a phone.
 * @param {string} phone10
 */
async function resolveLeadLinks(phone10) {
  const phone = normalizePhone10(phone10);
  if (!phone) {
    return {
      phone: null,
      productLine: 'unknown',
      formSubmissionId: null,
      iitCounsellingSubmissionId: null,
    };
  }

  const iit = await IitCounsellingSubmission.findOne({ phone })
    .sort({ updatedAt: -1 })
    .select('_id assignedBdaId assignedBdaName')
    .lean();

  if (iit) {
    return {
      phone,
      productLine: 'iit_counselling',
      formSubmissionId: null,
      iitCounsellingSubmissionId: iit._id,
      iitSub: iit,
    };
  }

  const gx = await FormSubmission.findOne({ phone }).select('_id').lean();
  if (gx) {
    return {
      phone,
      productLine: 'guidexpert',
      formSubmissionId: gx._id,
      iitCounsellingSubmissionId: null,
      formSub: gx,
    };
  }

  return {
    phone,
    productLine: 'unknown',
    formSubmissionId: null,
    iitCounsellingSubmissionId: null,
  };
}

module.exports = {
  normalizePhone10,
  formatPhoneE16491,
  maskPhoneTail,
  resolveLeadLinks,
};
