/**
 * P3: Project WhatsAppMessageEvent terminal state onto WhatsAppReminderJob.
 * Implementation lives in whatsappReminderJobLifecycle (hardening).
 */
const { syncReminderJobFromRetryGroup } = require('./whatsappReminderJobLifecycle');

module.exports = {
  syncReminderJobFromRetryGroup
};
