/**
 * OSVI outbound voice call API (https://api.osvi.ai/call).
 * Best-effort only — callers must not depend on success for user-facing flows.
 */

const DEFAULT_CALL_URL = 'https://api.osvi.ai/call';

/**
 * @param {{ phone_number: string, person_name: string, occupation: string }} params
 * @returns {Promise<{ success: boolean, error?: string, data?: unknown }>}
 */
async function initiateOutboundCall({ phone_number, person_name, occupation }) {
  const token = process.env.OSVI_API_TOKEN;
  const agentUuid = process.env.OSVI_AGENT_UUID;
  if (!token || !agentUuid) {
    return { success: false, error: 'OSVI not configured' };
  }

  const url = process.env.OSVI_CALL_URL || DEFAULT_CALL_URL;
  const countryCode = (process.env.OSVI_COUNTRY_CODE || 'IN').trim() || 'IN';

  const systemPromptEnv = process.env.OSVI_SYSTEM_PROMPT;
  const system_prompt =
    typeof systemPromptEnv === 'string' && systemPromptEnv.trim()
      ? systemPromptEnv.trim()
      : '';

  const webhookUrlEnv = process.env.OSVI_WEBHOOK_URL;
  const webhook_url =
    typeof webhookUrlEnv === 'string' && webhookUrlEnv.trim()
      ? webhookUrlEnv.trim()
      : '';

  const body = {
    agent_uuid: agentUuid,
    phone_number,
    country_code: countryCode,
    person_name,
    system_prompt,
    webhook_url,
    additional_data: {
      occupation,
      source: 'counselor_landing',
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'API-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      console.error('[OSVI] Call failed', res.status, data);
      const errMsg =
        (typeof data?.error === 'string' && data.error) ||
        (typeof data?.message === 'string' && data.message) ||
        `HTTP ${res.status}`;
      return {
        success: false,
        error: errMsg,
        data,
      };
    }

    return { success: true, data };
  } catch (err) {
    const msg = err && typeof err.message === 'string' ? err.message : String(err);
    console.error('[OSVI] Call error', msg);
    return { success: false, error: msg };
  }
}

module.exports = {
  initiateOutboundCall,
};
