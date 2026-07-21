const FormSubmission = require('../../models/FormSubmission');
const IitCounsellingSubmission = require('../../models/IitCounsellingSubmission');
const WhatsAppMessageEvent = require('../../models/WhatsAppMessageEvent');
const { buildSlotNotificationVariables, getDemoMeetingLink } = require('../../utils/slotNotificationFormatters');
const { PAYMENT_STATUS_LABELS, DEMO_STATUS_LABELS, CALL_STATUS_LABELS } = require('../../constants/bdaLeadCrm');

function formatIst(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Build unified lead context for orchestrator and handoff summaries.
 * @param {{ phone10: string, formSubmissionId?: object, iitCounsellingSubmissionId?: object }} links
 */
async function buildLeadContext(links) {
  const phone = links.phone;
  const ctx = {
    phone,
    productLine: links.productLine || 'unknown',
    hasGx: false,
    hasIit: false,
    gx: null,
    iit: null,
    meetingLink: getDemoMeetingLink(),
    iitPageUrl: process.env.IIT_COUNSELLING_PAGE_URL || 'https://www.guidexpert.co.in/iit-counselling',
  };

  if (links.iitCounsellingSubmissionId) {
    const iit = await IitCounsellingSubmission.findById(links.iitCounsellingSubmissionId).lean();
    if (iit) {
      ctx.hasIit = true;
      const s1 = iit.iitCounselling?.section1Data || {};
      const s2 = iit.iitCounselling?.section2Data || {};
      ctx.iit = {
        fullName: iit.fullName,
        slotBooking: s1.slotBooking || null,
        slotBookingDate: s1.slotBookingDate || null,
        slotInstantLabel: formatIst(iit.counsellingSlotInstantUtc),
        preferredLanguage: s2.preferredLanguage || null,
        city: s1.city || null,
        assignedBdaName: iit.assignedBdaName || null,
        callStatusLabel: CALL_STATUS_LABELS[iit.callStatus] || iit.callStatus,
        demoStatusLabel: DEMO_STATUS_LABELS[iit.demoStatus] || iit.demoStatus,
        paymentStatusLabel: PAYMENT_STATUS_LABELS[iit.paymentStatus] || iit.paymentStatus,
        currentStep: iit.iitCounselling?.currentStep || iit.currentStep,
        isCompleted: iit.isCompleted || iit.iitCounselling?.isCompleted,
      };
    }
  }

  if (links.formSubmissionId) {
    const gx = await FormSubmission.findById(links.formSubmissionId).lean();
    if (gx) {
      ctx.hasGx = true;
      const vars = buildSlotNotificationVariables(gx);
      ctx.gx = {
        fullName: gx.fullName,
        selectedSlot: gx.step3Data?.selectedSlot || gx.selectedSlot,
        slotDateLabel: vars.date,
        slotTimeLabel: vars.time,
        isRegistered: gx.isRegistered,
        currentStep: gx.currentStep,
        whatsappDeliveryStatus: gx.whatsappDeliveryStatus,
        rankPredictorLead: gx.rankPredictorLead || null,
      };
    }
  } else if (phone) {
    const gx = await FormSubmission.findOne({ phone }).lean();
    if (gx) {
      ctx.hasGx = true;
      const vars = buildSlotNotificationVariables(gx);
      ctx.gx = {
        fullName: gx.fullName,
        selectedSlot: gx.step3Data?.selectedSlot || gx.selectedSlot,
        slotDateLabel: vars.date,
        slotTimeLabel: vars.time,
        isRegistered: gx.isRegistered,
        currentStep: gx.currentStep,
        whatsappDeliveryStatus: gx.whatsappDeliveryStatus,
        rankPredictorLead: gx.rankPredictorLead || null,
      };
    }
  }

  if (!ctx.hasIit && phone) {
    const iit = await IitCounsellingSubmission.findOne({ phone }).sort({ updatedAt: -1 }).lean();
    if (iit) {
      ctx.hasIit = true;
      ctx.productLine = 'iit_counselling';
      const s1 = iit.iitCounselling?.section1Data || {};
      const s2 = iit.iitCounselling?.section2Data || {};
      ctx.iit = {
        fullName: iit.fullName,
        slotBooking: s1.slotBooking || null,
        slotBookingDate: s1.slotBookingDate || null,
        slotInstantLabel: formatIst(iit.counsellingSlotInstantUtc),
        preferredLanguage: s2.preferredLanguage || null,
        city: s1.city || null,
        assignedBdaName: iit.assignedBdaName || null,
        callStatusLabel: CALL_STATUS_LABELS[iit.callStatus] || iit.callStatus,
        demoStatusLabel: DEMO_STATUS_LABELS[iit.demoStatus] || iit.demoStatus,
        paymentStatusLabel: PAYMENT_STATUS_LABELS[iit.paymentStatus] || iit.paymentStatus,
        currentStep: iit.iitCounselling?.currentStep || iit.currentStep,
        isCompleted: iit.isCompleted || iit.iitCounselling?.isCompleted,
      };
    }
  }

  return ctx;
}

function buildAssignedExpertReply(leadContext) {
  if (!leadContext.hasIit || !leadContext.iit) {
    return [
      'We could not find an IIT counselling registration for this number.',
      `Register here: ${process.env.IIT_COUNSELLING_PAGE_URL || 'https://www.guidexpert.co.in/iit-counselling'}`,
      'Reply MENU for more options.',
    ].join('\n\n');
  }

  const name = leadContext.iit.assignedBdaName;
  if (!name) {
    return [
      'Your assigned IIT counselling expert will be confirmed shortly.',
      'Our team will share counsellor details before your session.',
      'Reply AGENT to connect with our team or MENU for options.',
    ].join('\n\n');
  }

  return [
    `Your assigned IIT counselling expert is ${name}.`,
    'They will support you through your counselling journey.',
    'Reply AGENT to message our team directly, or MENU for options.',
  ].join('\n\n');
}

async function buildHandoffSummary(leadContext) {
  const lines = [];
  lines.push(`Phone: ****${String(leadContext.phone || '').slice(-4)}`);
  lines.push(`Product: ${leadContext.productLine}`);
  if (leadContext.iit) {
    lines.push(`Name: ${leadContext.iit.fullName || '—'}`);
    lines.push(`IIT slot: ${leadContext.iit.slotBooking || '—'} (${leadContext.iit.slotInstantLabel || '—'})`);
    lines.push(`Language: ${leadContext.iit.preferredLanguage || '—'}`);
    lines.push(`BDA: ${leadContext.iit.assignedBdaName || 'unassigned'}`);
    lines.push(`Payment (CRM): ${leadContext.iit.paymentStatusLabel || '—'}`);
  }
  if (leadContext.gx) {
    lines.push(`GX name: ${leadContext.gx.fullName || '—'}`);
    lines.push(`Demo slot: ${leadContext.gx.slotDateLabel || '—'} ${leadContext.gx.slotTimeLabel || ''}`.trim());
    lines.push(`WA status: ${leadContext.gx.whatsappDeliveryStatus || '—'}`);
  }
  return lines.join('\n');
}

async function getRecentWaStatus(phone10, limit = 3) {
  return WhatsAppMessageEvent.find({ phone: phone10 })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('messageKind status webhookErrorCode createdAt')
    .lean();
}

module.exports = {
  buildLeadContext,
  buildAssignedExpertReply,
  buildHandoffSummary,
  getRecentWaStatus,
  formatIst,
};
