const { getDemoMeetingLink } = require('../../utils/slotNotificationFormatters');
const { getRecentWaStatus } = require('./leadContextService');
const { extractFirstName } = require('./welcomeMessageService');

async function buildCounsellingSupportReply(leadContext, opts = {}) {
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
  const firstName = extractFirstName(i.fullName);
  const greeting = firstName ? `Hi ${firstName}!` : 'Hi there!';
  lines.push(`${greeting} Here is your IIT counselling summary:`);
  lines.push(`• Session: ${i.slotBooking || 'Not set'}`);
  if (i.slotInstantLabel) lines.push(`• Date & Time (IST): ${i.slotInstantLabel}`);
  if (i.preferredLanguage) lines.push(`• Language: ${i.preferredLanguage}`);
  if (i.assignedBdaName) lines.push(`• Your counsellor (BDA): ${i.assignedBdaName}`);
  lines.push(`• Demo Status: ${i.demoStatusLabel || '—'}`);

  lines.push('');
  lines.push('Meeting Link:');
  lines.push(getDemoMeetingLink());

  const wa =
    opts.recentWa != null
      ? opts.recentWa
      : await getRecentWaStatus(leadContext.phone, 2);
  if (wa.length) {
    lines.push('');
    lines.push('Recent WhatsApp reminders:');
    wa.forEach((w) => {
      lines.push(`• ${w.messageKind}: ${w.status}${w.webhookErrorCode ? ` (${w.webhookErrorCode})` : ''}`);
    });
  }

  lines.push('');
  lines.push('Reply MENU for main menu or AGENT to speak with our team.');
  return lines.join('\n');
}

module.exports = { buildCounsellingSupportReply };
