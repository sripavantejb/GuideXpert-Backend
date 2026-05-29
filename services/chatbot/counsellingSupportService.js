const { getDemoMeetingLink } = require('../../utils/slotNotificationFormatters');
const { getRecentWaStatus } = require('./leadContextService');

async function buildCounsellingSupportReply(leadContext) {
  const lines = [];
  if (!leadContext.hasIit || !leadContext.iit) {
    lines.push(
      'We could not find an IIT counselling registration for this number.',
      `Register here: ${process.env.IIT_COUNSELLING_PAGE_URL || 'https://www.guidexpert.co.in/iit-counselling'}`,
      'Reply MENU for more options.'
    );
    return lines.join('\n\n');
  }

  const i = leadContext.iit;
  lines.push(`Hi ${i.fullName || 'there'}! Here is your IIT counselling summary:`);
  lines.push(`• Session: ${i.slotBooking || 'Not set'}`);
  if (i.slotInstantLabel) lines.push(`• Date & time (IST): ${i.slotInstantLabel}`);
  if (i.preferredLanguage) lines.push(`• Language: ${i.preferredLanguage}`);
  if (i.assignedBdaName) lines.push(`• Your counsellor (BDA): ${i.assignedBdaName}`);
  lines.push(`• Demo status: ${i.demoStatusLabel || '—'}`);
  lines.push(`• Payment status (our records): ${i.paymentStatusLabel || '—'}`);
  lines.push(`\nMeeting link (if shared for your session): ${getDemoMeetingLink()}`);

  const wa = await getRecentWaStatus(leadContext.phone, 2);
  if (wa.length) {
    lines.push('\nRecent WhatsApp reminders:');
    wa.forEach((w) => {
      lines.push(`• ${w.messageKind}: ${w.status}${w.webhookErrorCode ? ` (${w.webhookErrorCode})` : ''}`);
    });
  }

  lines.push('\nReply MENU for main menu or AGENT to speak with our team.');
  return lines.join('\n');
}

module.exports = { buildCounsellingSupportReply };
