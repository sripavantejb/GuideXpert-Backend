/**
 * Phase 2: LLM-grounded replies (disabled unless CHATBOT_LLM_ENABLED=1).
 */

async function tryLlmReply({ inboundText, facts, leadContext }) {
  if (String(process.env.CHATBOT_LLM_ENABLED || '').trim() !== '1') {
    return null;
  }

  const apiKey = process.env.OPENAI_API_KEY || process.env.CHATBOT_LLM_API_KEY;
  if (!apiKey) return null;

  try {
    const axios = require('axios');
    const model = process.env.CHATBOT_LLM_MODEL || 'gpt-4o-mini';
    const system = `You are GuideXpert WhatsApp assistant. Answer ONLY using the JSON facts provided. If facts are insufficient, tell the user to reply MENU or AGENT. Keep replies under 800 characters. Do not invent fees, payment amounts, or admission guarantees.`;

    const userContent = JSON.stringify({
      question: inboundText,
      facts: {
        productLine: leadContext.productLine,
        iit: leadContext.iit,
        gx: leadContext.gx,
        links: facts.links,
      },
    });

    const res = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );

    const text = res.data?.choices?.[0]?.message?.content;
    if (text && String(text).trim()) {
      return { text: String(text).trim().slice(0, 3500) };
    }
  } catch (e) {
    console.warn('[chatbot] LLM error', e.message);
  }
  return null;
}

module.exports = { tryLlmReply };
