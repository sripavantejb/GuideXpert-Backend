#!/usr/bin/env node
/**
 * Probe production WhatsApp / chatbot configuration (no secrets sent).
 * Usage: node scripts/check-whatsapp-production.js
 *        API_HOST=guide-xpert-backend.vercel.app node scripts/check-whatsapp-production.js
 */
const https = require('https');

const host = process.env.API_HOST || 'guide-xpert-backend.vercel.app';

function get(path) {
  return new Promise((resolve, reject) => {
    https
      .get({ hostname: host, path, timeout: 15000 }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      })
      .on('error', reject);
  });
}

function postWebhook() {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ type: 'message' });
    const req = https.request(
      {
        hostname: host,
        path: '/webhook/gupshup',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log(`Checking https://${host}\n`);

  const health = await get('/api/health');
  console.log('GET /api/health', health.status);
  if (health.body && health.body.whatsapp) {
    console.log('  whatsapp:', JSON.stringify(health.body.whatsapp, null, 2));
  } else {
    console.log('  (deploy backend with whatsapp health flags to see details)');
  }
  if (health.body?.counsellorProgramAssistant) {
    console.log('  counsellorProgramAssistant:', JSON.stringify(health.body.counsellorProgramAssistant, null, 2));
  } else {
    console.log('  counsellorProgramAssistant: (missing — deploy Phase 7 health probe and set CHATBOT_COUNSELLOR_PROGRAM_ASSISTANT_ENABLED=1 on Vercel)');
  }
  if (health.body?.iitCounsellingExpert) {
    console.log('  iitCounsellingExpert:', JSON.stringify(health.body.iitCounsellingExpert, null, 2));
  } else {
    console.log('  iitCounsellingExpert: (missing — deploy Phase 8 health probe and set CHATBOT_IIT_COUNSELLING_EXPERT_ENABLED=1 on Vercel)');
  }
  if (health.body?.scopeFirewall) {
    console.log('  scopeFirewall:', JSON.stringify(health.body.scopeFirewall, null, 2));
    if (!health.body.scopeFirewall.enabled) {
      console.log('\n→ CHATBOT_SCOPE_FIREWALL_ENABLED must be 1 in production. See docs/whatsapp-chatbot-production-setup.md');
      process.exit(1);
    }
    if (health.body.scopeFirewall.shadowMode === true) {
      console.log('\n→ Scope firewall is in shadow mode (log-only). Set CHATBOT_SCOPE_FIREWALL_SHADOW_MODE=0 for production enforce.');
    }
    if (health.body.scopeFirewall.productionReady === false) {
      console.log('\n→ Scope firewall is not production-ready (requires enabled + enforce mode).');
      process.exit(1);
    }
  } else {
    console.log('  scopeFirewall: (missing — deploy scope firewall health probe)');
    process.exit(1);
  }

  const webhook = await postWebhook();
  console.log('\nPOST /webhook/gupshup (no auth)', webhook.status);
  console.log('  body:', JSON.stringify(webhook.body));

  if (webhook.status === 503 && webhook.body?.error === 'webhook_secret_not_configured') {
    console.log(
      '\n→ GUPSHUP_WEBHOOK_AUTH_REQUIRED=1 but no secret. Unset AUTH_REQUIRED or add GUPSHUP_WEBHOOK_SECRET. See docs/whatsapp-chatbot-production-setup.md'
    );
    process.exit(1);
  }
  if (webhook.status === 401) {
    console.log('\n→ Webhook secret is configured; ensure Gupshup sends x-webhook-secret or ?secret=');
  }
  if (webhook.status === 200) {
    console.log('\n→ Webhook accepts inbound (auth off or matched). Check whatsapp.gupshupConfigured on /api/health.');
  }
  if (health.body?.whatsapp?.ready) {
    console.log('\n→ Chatbot config looks ready. Send a test WhatsApp message.');
    process.exit(0);
  }
  process.exit(health.body?.whatsapp?.ready ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
