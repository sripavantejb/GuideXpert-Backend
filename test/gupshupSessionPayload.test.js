'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTextMessageField,
  buildInteractiveButtonMessageField,
  buildInteractiveListMessageField,
  buildImageMessageField,
  listMessageNeedsEncode,
} = require('../utils/gupshupSessionPayload');

describe('gupshupSessionPayload', () => {
  test('buildTextMessageField', () => {
    const j = JSON.parse(buildTextMessageField('Hello'));
    assert.equal(j.type, 'text');
    assert.equal(j.text, 'Hello');
  });

  test('buildImageMessageField uses Gupshup image shape with caption', () => {
    const j = JSON.parse(
      buildImageMessageField({ url: 'https://cdn.example.com/a.jpg', caption: 'Great! 👍' })
    );
    assert.equal(j.type, 'image');
    assert.equal(j.originalUrl, 'https://cdn.example.com/a.jpg');
    assert.equal(j.previewUrl, 'https://cdn.example.com/a.jpg');
    assert.equal(j.caption, 'Great! 👍');
  });

  test('buildImageMessageField omits an empty caption', () => {
    const j = JSON.parse(buildImageMessageField({ url: 'https://cdn.example.com/a.jpg' }));
    assert.equal(j.caption, undefined);
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

  test('buildInteractiveListMessageField omits the card title when title is blank', () => {
    const j = JSON.parse(
      buildInteractiveListMessageField({
        title: '',
        body: 'Which of these actually interest you?',
        buttonText: 'Select',
        sections: [{ title: 'Options', rows: [{ id: 'a', title: 'AI' }] }],
      })
    );
    // Single-line body: do not duplicate into the header.
    assert.equal(Object.prototype.hasOwnProperty.call(j, 'title'), false);
    assert.equal(j.items[0].title, 'Options');
    assert.equal(j.body, 'Which of these actually interest you?');
  });

  test('blank list title promotes the first body line into the header row', () => {
    const j = JSON.parse(
      buildInteractiveListMessageField({
        title: '',
        body:
          '👋 Hi! Welcome to GuideXpert.\n\n' +
          "I'm Rithika from the GuideXpert Counselling Team. 😊\n\n" +
          'First, may I know your current qualification?',
        buttonText: 'Select',
        sections: [{ title: 'Options', rows: [{ id: 'a', title: 'AI' }] }],
      })
    );
    assert.equal(j.title, '👋 Hi! Welcome to GuideXpert.');
    assert.equal(
      j.body,
      "I'm Rithika from the GuideXpert Counselling Team. 😊\n\nFirst, may I know your current qualification?"
    );
  });

  test('leading and trailing blank lines are stripped from every body', () => {
    assert.equal(JSON.parse(buildTextMessageField('\n\n  Hello  \n\n')).text, 'Hello');
    assert.equal(
      JSON.parse(buildInteractiveButtonMessageField({ body: '\nChoose\n\n', buttons: [] })).content
        .text,
      'Choose'
    );
    assert.equal(
      JSON.parse(
        buildInteractiveListMessageField({
          title: '',
          body: '\u200b\nPick one\n ',
          buttonText: 'Select',
          sections: [{ title: 'Options', rows: [{ id: 'a', title: 'AI' }] }],
        })
      ).body,
      'Pick one'
    );
    assert.equal(
      JSON.parse(buildImageMessageField({ url: 'https://x/a.jpg', caption: '\n\nGreat! 👍\n' }))
        .caption,
      'Great! 👍'
    );
  });

  test('paragraph spacing survives, runaway blank lines collapse', () => {
    assert.equal(
      JSON.parse(buildTextMessageField('Great! 👍\n\nBefore I recommend colleges.')).text,
      'Great! 👍\n\nBefore I recommend colleges.'
    );
    assert.equal(JSON.parse(buildTextMessageField('A\n\n\n\nB')).text, 'A\n\nB');
  });

  test('listMessageNeedsEncode detects emoji', () => {
    assert.equal(listMessageNeedsEncode('Hi 😊', []), true);
    assert.equal(listMessageNeedsEncode('Hi', []), false);
  });
});
