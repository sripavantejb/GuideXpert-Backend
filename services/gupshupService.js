/**
 * Gupshup WhatsApp template messages (wa/api/v1).
 *
 * Env: ENABLE_WHATSAPP, GUPSHUP_API_KEY, GUPSHUP_SOURCE,
 * GUPSHUP_TEMPLATE_REMINDER, GUPSHUP_TEMPLATE_PRE4HR, GUPSHUP_TEMPLATE_MEET,
 * GUPSHUP_TEMPLATE_30MIN, optional GUPSHUP_SRC_NAME
 */
const axios = require('axios');
const {
  SLOT_BOOKED_PARAM_KEYS,
  PRE4HR_PARAM_KEYS,
  MEET_PARAM_KEYS,
  REMINDER_30MIN_PARAM_KEYS,
  buildParamsFromKeys
} = require('../utils/gupshupWhatsAppTemplateParams');

const GUPSHUP_TEMPLATE_URL = 'https://api.gupshup.io/wa/api/v1/template/msg';

function isWhatsAppEnabled() {
  const v = process.env.ENABLE_WHATSAPP;
  if (v == null || String(v).trim() === '') return false;
  const lower = String(v).toLowerCase().trim();
  return !['0', 'false', 'no', 'off'].includes(lower);
}

function maskPhoneTail(digits) {
  const d = String(digits).replace(/\D/g, '');
  const last4 = d.slice(-4);
  return last4.length === 4 ? `****${last4}` : '****';
}

/**
 * @param {string} phone10OrMore - 10-digit Indian mobile or longer digit string
 * @returns {string} e.g. 91XXXXXXXXXX
 */
function formatPhoneE16491(phone10OrMore) {
  const digits = String(phone10OrMore).replace(/\D/g, '');
  const ten = digits.length >= 10 ? digits.slice(-10) : digits;
  return `91${ten}`;
}

/**
 * @param {string} phoneE164 - destination already 91XXXXXXXXXX
 * @param {string} templateId - Gupshup template id
 * @param {string[]} params - ordered body variable values
 * @returns {Promise<{ success: boolean, data?: unknown, error?: string }>}
 */
async function sendTemplateMessage(phoneE164, templateId, params) {
  if (!isWhatsAppEnabled()) {
    return { success: false, error: 'WhatsApp disabled (ENABLE_WHATSAPP)' };
  }

  const apiKey = process.env.GUPSHUP_API_KEY;
  const source = process.env.GUPSHUP_SOURCE;
  if (!apiKey || !source) {
    console.warn('[Gupshup] Missing GUPSHUP_API_KEY or GUPSHUP_SOURCE');
    return { success: false, error: 'Gupshup not configured' };
  }
  if (!templateId) {
    return { success: false, error: 'template id missing' };
  }

  const destination = String(phoneE164).replace(/\D/g, '');
  const templatePayload = JSON.stringify({ id: templateId, params: params || [] });

  const body = new URLSearchParams();
  body.append('source', source.replace(/\D/g, ''));
  body.append('destination', destination);
  body.append('channel', 'whatsapp');
  body.append('template', templatePayload);
  const srcName = process.env.GUPSHUP_SRC_NAME;
  if (srcName) {
    body.append('src.name', srcName);
  }

  try {
    const res = await axios.post(GUPSHUP_TEMPLATE_URL, body.toString(), {
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 20000,
      validateStatus: () => true
    });

    const data = res.data;
    const mask = maskPhoneTail(destination);

    if (res.status >= 400) {
      const errMsg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
      console.error('[Gupshup] Template send failed', mask, errMsg, data);
      return { success: false, error: String(errMsg), data };
    }

    if (data && (data.status === 'error' || data.success === false)) {
      const errMsg = data.message || data.error || 'Gupshup API error';
      console.error('[Gupshup] Template send rejected', mask, errMsg, data);
      return { success: false, error: String(errMsg), data };
    }

    console.log('[Gupshup] Template submitted', mask, templateId);
    return { success: true, data };
  } catch (e) {
    const msg = e.response && e.response.data
      ? (e.response.data.message || e.response.data.error || e.message)
      : e.message;
    console.error('[Gupshup] Template send exception', maskPhoneTail(destination), msg);
    return { success: false, error: msg || 'Gupshup request failed' };
  }
}

async function sendSlotBookedWhatsApp(phone10, vars) {
  const tid = process.env.GUPSHUP_TEMPLATE_REMINDER;
  const params = buildParamsFromKeys(vars, SLOT_BOOKED_PARAM_KEYS);
  return sendTemplateMessage(formatPhoneE16491(phone10), tid, params);
}

async function sendPre4HrReminderWhatsApp(phone10, vars) {
  const tid = process.env.GUPSHUP_TEMPLATE_PRE4HR;
  const params = buildParamsFromKeys(vars, PRE4HR_PARAM_KEYS);
  return sendTemplateMessage(formatPhoneE16491(phone10), tid, params);
}

async function sendMeetLinkWhatsApp(phone10, vars) {
  const tid = process.env.GUPSHUP_TEMPLATE_MEET;
  const params = buildParamsFromKeys(vars, MEET_PARAM_KEYS);
  return sendTemplateMessage(formatPhoneE16491(phone10), tid, params);
}

async function sendReminder30MinWhatsApp(phone10, vars) {
  const tid = process.env.GUPSHUP_TEMPLATE_30MIN;
  const params = buildParamsFromKeys(vars, REMINDER_30MIN_PARAM_KEYS);
  return sendTemplateMessage(formatPhoneE16491(phone10), tid, params);
}

module.exports = {
  isWhatsAppEnabled,
  formatPhoneE16491,
  sendTemplateMessage,
  sendSlotBookedWhatsApp,
  sendPre4HrReminderWhatsApp,
  sendMeetLinkWhatsApp,
  sendReminder30MinWhatsApp
};
