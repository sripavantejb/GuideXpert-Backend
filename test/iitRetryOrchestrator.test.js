const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sendFnForKind } = require('../services/whatsappRetryOrchestrator');
const { isCampaignStrategy } = require('../utils/whatsappRetryRules');
const { isIitReminderMessageKind } = require('../utils/iitCounsellingWhatsApp');

describe('IIT retry orchestrator', () => {
  it('treats IIT reminder kinds as campaign strategy', () => {
    for (const kind of ['iit_pre2hr', 'iit_pre45min', 'iit_pre15min']) {
      assert.ok(isIitReminderMessageKind(kind));
      assert.ok(isCampaignStrategy(kind));
    }
  });

  it('sendFnForKind resolves IIT reminder senders', () => {
    assert.equal(typeof sendFnForKind('iit_pre2hr'), 'function');
    assert.equal(typeof sendFnForKind('iit_pre45min'), 'function');
    assert.equal(typeof sendFnForKind('iit_pre15min'), 'function');
    assert.equal(sendFnForKind('unknown_kind_xyz'), null);
  });
});
