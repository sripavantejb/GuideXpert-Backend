const { getDemoMeetingLink } = require('../../utils/slotNotificationFormatters');
const { getRecentWaStatus } = require('./leadContextService');

async function buildDemoSupportReply(leadContext) {
  const lines = [];
  if (!leadContext.hasGx || !leadContext.gx) {
    lines.push(
      'We could not find a demo registration for this number.',
      `You can register at ${process.env.REGISTRATION_BASE_URL || process.env.FRONTEND_URL || 'https://www.guidexpert.co.in'}`,
      'Reply MENU for more options.'
    );
    return lines.join('\n\n');
  }

  const g = leadContext.gx;
  lines.push(`Hi ${g.fullName || 'there'}! Your GuideXpert demo details:`);
  if (g.slotDateLabel || g.slotTimeLabel) {
    lines.push(`• Slot: ${[g.slotDateLabel, g.slotTimeLabel].filter(Boolean).join(' at ')}`);
  } else {
    lines.push('• Slot: not booked yet — complete Step 3 on the registration form.');
  }
  lines.push(`• Registered: ${g.isRegistered ? 'Yes' : 'In progress (step ' + (g.currentStep || '?') + ')'}`);
  lines.push(`• Meeting link: ${getDemoMeetingLink()}`);
  if (g.whatsappDeliveryStatus) {
    lines.push(`• Last WhatsApp status: ${g.whatsappDeliveryStatus}`);
  }

  const wa = await getRecentWaStatus(leadContext.phone, 2);
  if (wa.length) {
    lines.push('\nRecent WhatsApp messages:');
    wa.forEach((w) => {
      lines.push(`• ${w.messageKind}: ${w.status}`);
    });
  }

  lines.push('\nReply MENU for main menu or AGENT for human support.');
  return lines.join('\n');
}

module.exports = { buildDemoSupportReply };
