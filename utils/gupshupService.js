const axios = require('axios');

const API_URL = 'https://api.gupshup.io/wa/api/v1/msg';

/**
 * Send OTP via WhatsApp using Gupshup Sandbox
 * @param {string} phone - 10-digit Indian number (no 91)
 * @param {string} otp - 6-digit OTP
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function sendWhatsAppOTP(phone, otp) {
  const apiKey = process.env.GUPSHUP_API_KEY;
  const source = process.env.GUPSHUP_SANDBOX_SOURCE;
  const appName = process.env.GUPSHUP_APP_NAME;
  if (!apiKey || !source || !appName) {
    return { success: false, error: 'WhatsApp not configured' };
  }
  const digits = String(phone).replace(/\D/g, '');
  const destination = digits.length >= 10 ? '91' + digits.slice(-10) : '91' + digits;
  const text = `Your verification code is ${otp}. It expires in 5 minutes.`;
  const message = JSON.stringify({ type: 'text', text });
  const body = new URLSearchParams({
    channel: 'whatsapp',
    source,
    destination,
    message,
    'src.name': appName
  }).toString();

  try {
    const res = await axios.post(API_URL, body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        apikey: apiKey
      },
      timeout: 15000,
      validateStatus: () => true
    });
    if (res.status >= 400) {
      const err = (res.data && (res.data.message || res.data.error)) || `API returned ${res.status}`;
      return { success: false, error: String(err) };
    }
    if (res.data && (res.data.status === 'error' || res.data.success === false)) {
      const err = (res.data && (res.data.message || res.data.error)) || 'Gupshup error';
      return { success: false, error: String(err) };
    }
    return { success: true };
  } catch (e) {
    const msg = e.response && e.response.data ? (e.response.data.message || e.response.data.error) : e.message;
    return { success: false, error: msg || 'Failed to send OTP' };
  }
}

module.exports = { sendWhatsAppOTP };
