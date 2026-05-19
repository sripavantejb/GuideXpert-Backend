'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { buildTemplateField, buildImageMessageField } = require('../utils/gupshupTemplatePayload');
const {
  resolveIitSlotBookedHeaderImageUrl,
  GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL
} = require('../utils/iitCounsellingWhatsApp');
const {
  buildTemplateRequestFields,
  sendSlotBookedWhatsApp,
  IIT_HEADER_MISSING_ERROR
} = require('../services/gupshupService');

const HEADER_URL =
  'https://res.cloudinary.com/dfqdb1xws/image/upload/v1779169268/image_1_opyelz.png';

describe('gupshupTemplatePayload builders', () => {
  test('buildTemplateField produces id + params only', () => {
    assert.equal(
      buildTemplateField({ id: 'tpl-1', params: ['Asha'] }),
      JSON.stringify({ id: 'tpl-1', params: ['Asha'] })
    );
  });

  test('buildImageMessageField matches Gupshup image header shape', () => {
    assert.deepEqual(JSON.parse(buildImageMessageField({ link: HEADER_URL })), {
      type: 'image',
      image: { link: HEADER_URL }
    });
  });
});

describe('resolveIitSlotBookedHeaderImageUrl', () => {
  const snapshot = {};

  beforeEach(() => {
    snapshot[GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL] = process.env[GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL];
    delete process.env[GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL];
  });

  afterEach(() => {
    if (snapshot[GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL] === undefined) {
      delete process.env[GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL];
    } else {
      process.env[GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL] = snapshot[GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL];
    }
  });

  test('returns null when env unset', () => {
    assert.equal(resolveIitSlotBookedHeaderImageUrl(), null);
  });

  test('rejects non-https URLs', () => {
    process.env[GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL] = 'http://example.com/x.png';
    assert.equal(resolveIitSlotBookedHeaderImageUrl(), null);
  });

  test('accepts https URL', () => {
    process.env[GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL] = HEADER_URL;
    assert.equal(resolveIitSlotBookedHeaderImageUrl(), HEADER_URL);
  });
});

describe('buildTemplateRequestFields', () => {
  test('IIT image header adds message field', () => {
    const fields = buildTemplateRequestFields({
      templateId: 'tpl-wed',
      params: ['Raj'],
      headerImageLink: HEADER_URL,
      source: '919999999999',
      destination: '919876543210'
    });
    assert.ok(fields.template);
    assert.ok(fields.message);
    const tpl = JSON.parse(fields.template);
    const msg = JSON.parse(fields.message);
    assert.equal(tpl.params.length, 1);
    assert.equal(msg.type, 'image');
    assert.equal(msg.image.link, HEADER_URL);
  });

  test('GuideXpert text-only omits message field', () => {
    const fields = buildTemplateRequestFields({
      templateId: 'tpl-gx',
      params: ['Raj', 'Thu at 6PM'],
      source: '919999999999',
      destination: '919876543210'
    });
    assert.ok(fields.template);
    assert.equal(fields.message, undefined);
    const tpl = JSON.parse(fields.template);
    assert.equal(tpl.params.length, 2);
  });

  test('logOutbound trace bodyString contains urlencoded message= for IIT header', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(' '));
    };
    try {
      buildTemplateRequestFields({
        templateId: 'tpl-wed',
        params: ['Raj'],
        headerImageLink: HEADER_URL,
        source: '919999999999',
        destination: '919876543210',
        logOutbound: true
      });
      const traceLine = logs.find((l) => l.includes('buildTemplateRequestFields'));
      assert.ok(traceLine, 'expected iit_wa_send_trace log');
      const parsed = JSON.parse(traceLine);
      assert.equal(parsed.appendMessage, true);
      assert.equal(parsed.hasMessageField, true);
      assert.ok(parsed.bodyString.includes('message='));
      assert.ok(parsed.bodyString.includes(encodeURIComponent(HEADER_URL)));
    } finally {
      console.log = origLog;
    }
  });
});

describe('gupshup_template_send log payload', () => {
  test('JSON.stringify does not ReferenceError (messagePayloadObj not messagePayload)', () => {
    const messagePayloadObj = { type: 'image', image: { link: HEADER_URL } };
    const templatePayloadObj = { id: 'tpl-wed-id', params: ['Test'] };
    assert.doesNotThrow(() => {
      const line = JSON.stringify({
        event: 'gupshup_template_send',
        headerType: messagePayloadObj ? 'image' : null,
        messagePayload: messagePayloadObj,
        templatePayload: templatePayloadObj,
        hasMessageInOutboundBody: true
      });
      const parsed = JSON.parse(line);
      assert.equal(parsed.headerType, 'image');
      assert.equal(parsed.messagePayload.image.link, HEADER_URL);
    });
  });
});

describe('sendSlotBookedWhatsApp IIT fail-fast', () => {
  const envSnapshot = {};

  beforeEach(() => {
    for (const k of [
      'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_WEDNESDAY',
      'GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL',
      'WA_INTEGRATION_STUB',
      'ENABLE_WHATSAPP'
    ]) {
      envSnapshot[k] = Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined;
    }
    process.env.GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_WEDNESDAY = 'tpl-wed-id';
    delete process.env.GUPSHUP_IIT_SLOT_BOOKED_HEADER_IMAGE_URL;
    delete process.env.WA_INTEGRATION_STUB;
    process.env.ENABLE_WHATSAPP = 'true';
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(envSnapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('fails before provider when IIT header URL missing', async () => {
    const r = await sendSlotBookedWhatsApp(
      '9876543210',
      { name: 'Test' },
      { templateEnvKey: 'GUPSHUP_TEMPLATE_IIT_SLOT_BOOKED_WEDNESDAY' }
    );
    assert.equal(r.success, false);
    assert.equal(r.error, IIT_HEADER_MISSING_ERROR);
  });
});
