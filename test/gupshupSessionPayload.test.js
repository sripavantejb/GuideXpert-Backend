'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTextMessageField,
  buildInteractiveButtonMessageField,
} = require('../utils/gupshupSessionPayload');

describe('gupshupSessionPayload', () => {
  test('buildTextMessageField', () => {
    const j = JSON.parse(buildTextMessageField('Hello'));
    assert.equal(j.type, 'text');
    assert.equal(j.text, 'Hello');
  });

  test('buildInteractiveButtonMessageField', () => {
    const j = JSON.parse(
      buildInteractiveButtonMessageField({
        body: 'Choose',
        buttons: [{ id: 'a', title: 'A' }],
      })
    );
    assert.equal(j.type, 'interactive');
    assert.equal(j.interactive.type, 'button');
  });
});
