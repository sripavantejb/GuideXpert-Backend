'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTextMessageField,
  buildInteractiveButtonMessageField,
  buildInteractiveListMessageField,
  listMessageNeedsEncode,
} = require('../utils/gupshupSessionPayload');

describe('gupshupSessionPayload', () => {
  test('buildTextMessageField', () => {
    const j = JSON.parse(buildTextMessageField('Hello'));
    assert.equal(j.type, 'text');
    assert.equal(j.text, 'Hello');
  });

  test('buildInteractiveButtonMessageField uses Gupshup quick_reply shape', () => {
    const j = JSON.parse(
      buildInteractiveButtonMessageField({
        body: 'Choose',
        buttons: [{ id: 'a', title: 'A' }],
      })
    );
    assert.equal(j.type, 'quick_reply');
    assert.equal(j.content.type, 'text');
    assert.equal(j.content.text, 'Choose');
    assert.equal(j.options.length, 1);
    assert.equal(j.options[0].title, 'A');
    assert.equal(j.options[0].postbackText, 'a');
    assert.equal(j.interactive, undefined);
  });

  test('buildInteractiveListMessageField uses Gupshup list shape', () => {
    const j = JSON.parse(
      buildInteractiveListMessageField({
        body: 'Nice to meet you 😊\nQuick one first — can I know your qualification?',
        buttonText: 'Select',
        sections: [
          {
            title: 'Where are you right now?',
            rows: [
              { id: 'flowv2_qual_10_completed', title: '10th Completed' },
              { id: 'flowv2_qual_12_commerce', title: '12th Commerce' },
            ],
          },
        ],
      })
    );
    assert.equal(j.type, 'list');
    assert.equal(j.title, 'Where are you right now?');
    assert.equal(j.body.includes('Nice to meet you'), true);
    assert.equal(j.globalButtons[0].title, 'Select');
    assert.equal(j.items[0].options[0].postbackText, 'flowv2_qual_10_completed');
    assert.equal(j.items[0].options[1].title, '12th Commerce');
    assert.equal(j.interactive, undefined);
  });

  test('buildInteractiveListMessageField hides card title when title is blank', () => {
    const j = JSON.parse(
      buildInteractiveListMessageField({
        title: '',
        body: 'Which of these actually interest you?',
        buttonText: 'Select',
        sections: [{ title: 'Options', rows: [{ id: 'a', title: 'AI' }] }],
      })
    );
    assert.equal(j.title, '\u200b');
    assert.equal(j.items[0].title, 'Options');
    assert.equal(j.body, 'Which of these actually interest you?');
  });

  test('listMessageNeedsEncode detects emoji', () => {
    assert.equal(listMessageNeedsEncode('Hi 😊', []), true);
    assert.equal(listMessageNeedsEncode('Hi', []), false);
  });
});
