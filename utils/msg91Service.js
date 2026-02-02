const axios = require('axios');

const MSG91_SEND_OTP_URL = 'https://control.msg91.com/api/v5/otp';
const MSG91_FLOW_URL = 'https://control.msg91.com/api/v5/flow/';

/**
 * Send OTP via MSG91 SMS API (control.msg91.com).
 * @param {string} phone - 10-digit Indian number (no 91)
 * @param {string} otp - 6-digit OTP to send
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function sendOtp(phone, otp) {
  const authkey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;
  const otpExpiry = Number(process.env.OTP_EXPIRY_MINUTES) || 5;

  if (!authkey || !templateId) {
    return { success: false, error: 'MSG91 not configured' };
  }

  const digits = String(phone).replace(/\D/g, '');
  const mobile = digits.length >= 10 ? '91' + digits.slice(-10) : '91' + digits;

  // Match exact API from your curl: mobile, authkey, otp_expiry, template_id
  const params = new URLSearchParams({
    mobile,
    authkey,
    otp_expiry: String(otpExpiry),
    template_id: templateId,
    otp: String(otp)
  });

  const url = `${MSG91_SEND_OTP_URL}?${params.toString()}`;

  try {
    const res = await axios.get(url, {
      timeout: 15000,
      validateStatus: () => true
    });

    if (res.status >= 400) {
      const err = (res.data && (res.data.message || res.data.error)) || `API returned ${res.status}`;
      logSendResult(phone, false, err);
      return { success: false, error: String(err) };
    }

    const data = res.data || {};
    if (data.type === 'error' || data.status === 'error' || data.success === false) {
      const err = data.message || data.error || 'MSG91 error';
      logSendResult(phone, false, err);
      return { success: false, error: String(err) };
    }

    logSendResult(phone, true);
    return { success: true };
  } catch (e) {
    const msg = e.response && e.response.data
      ? (e.response.data.message || e.response.data.error)
      : e.message;
    logSendResult(phone, false, msg);
    return { success: false, error: msg || 'Failed to send OTP' };
  }
}

/**
 * Log send result without sensitive data (no OTP, no full mobile).
 */
function logSendResult(phone, success, detail) {
  const last4 = String(phone).replace(/\D/g, '').slice(-4);
  const mask = last4.length === 4 ? `****${last4}` : '****';
  if (success) {
    console.log('[MSG91] Send OTP success for', mask);
  } else {
    console.warn('[MSG91] Send OTP failed for', mask, detail || '');
  }
}

/**
 * Send Slot Confirmation SMS via MSG91 Flow API (transactional SMS).
 * Uses the same template-based approach as OTP but for notifications.
 * @param {string} phone - 10-digit Indian number (no 91)
 * @param {Object} variables - Template variables (name, date, time will be mapped to template vars)
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function sendSlotConfirmationSms(phone, variables = {}) {
  const authkey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_SLOT_CONFIRMATION_TEMPLATE_ID;

  if (!authkey || !templateId) {
    console.warn('[MSG91] Slot confirmation SMS not configured (missing AUTH_KEY or SLOT_CONFIRMATION_TEMPLATE_ID)');
    return { success: false, error: 'MSG91 slot confirmation not configured' };
  }

  // Normalize phone number: extract digits and prepend 91 for India
  const digits = String(phone).replace(/\D/g, '');
  const mobile = digits.length >= 10 ? '91' + digits.slice(-10) : '91' + digits;

  console.log('[MSG91] Sending slot confirmation SMS:', {
    mobile: `****${mobile.slice(-4)}`,
    templateId,
    variables
  });

  // Build request body for MSG91 Flow API
  // The flow_id is the template ID from MSG91
  const requestBody = {
    flow_id: templateId,
    mobiles: mobile,
    // Pass template variables - these should match your MSG91 template placeholders
    // If your template uses ##name##, ##date##, ##time##, use those exact keys
    name: variables.name || '',
    date: variables.date || '',
    time: variables.time || ''
  };

  try {
    const res = await axios.post(MSG91_FLOW_URL, requestBody, {
      headers: {
        'authkey': authkey,
        'Content-Type': 'application/json'
      },
      timeout: 15000,
      validateStatus: () => true
    });

    console.log('[MSG91] Flow API response:', {
      status: res.status,
      data: res.data
    });

    if (res.status >= 400) {
      const err = (res.data && (res.data.message || res.data.error)) || `API returned ${res.status}`;
      logSlotSmsResult(phone, false, err);
      return { success: false, error: String(err) };
    }

    const data = res.data || {};
    if (data.type === 'error' || data.status === 'error' || data.success === false) {
      const err = data.message || data.error || 'MSG91 error';
      logSlotSmsResult(phone, false, err);
      return { success: false, error: String(err) };
    }

    logSlotSmsResult(phone, true);
    return { success: true };
  } catch (e) {
    const msg = e.response && e.response.data
      ? (e.response.data.message || e.response.data.error)
      : e.message;
    console.error('[MSG91] Flow API exception:', e.message);
    logSlotSmsResult(phone, false, msg);
    return { success: false, error: msg || 'Failed to send slot confirmation SMS' };
  }
}

/**
 * Log slot SMS result without sensitive data.
 */
function logSlotSmsResult(phone, success, detail) {
  const last4 = String(phone).replace(/\D/g, '').slice(-4);
  const mask = last4.length === 4 ? `****${last4}` : '****';
  if (success) {
    console.log('[MSG91] Slot confirmation SMS sent successfully for', mask);
  } else {
    console.warn('[MSG91] Slot confirmation SMS failed for', mask, detail || '');
  }
}

module.exports = {
  sendOtp,
  sendSlotConfirmationSms
};
