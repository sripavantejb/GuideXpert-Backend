'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { formatForWhatsApp } = require('../utils/whatsappMessageFormatter');

describe('whatsappMessageFormatter', () => {
  test('strips HTML br tags and converts to newlines', () => {
    const input = 'CSE<br>• Good for software jobs<br/>• Learn coding';
    const output = formatForWhatsApp(input);
    assert.doesNotMatch(output, /<br/i);
    assert.match(output, /CSE/);
    assert.match(output, /• Good for software jobs/);
  });

  test('converts markdown table to branch bullet sections', () => {
    const input = [
      '| Branch | Why it can be a good choice | What you will learn |',
      '| --- | --- | --- |',
      '| **CSE** | Good for software jobs. <br>• Strong demand | Coding and algorithms |',
      '| **ECE** | Good for hardware and IoT | Electronics and embedded systems |',
    ].join('\n');

    const output = formatForWhatsApp(input);
    assert.doesNotMatch(output, /\|/);
    assert.match(output, /^CSE$/m);
    assert.match(output, /• Good for software jobs/);
    assert.match(output, /• Coding and algorithms/);
    assert.match(output, /^ECE$/m);
    assert.match(output, /• Good for hardware and IoT/);
  });

  test('converts markdown headings to plain text', () => {
    const input = '### How to decide\n\n1. Pick based on interest.';
    const output = formatForWhatsApp(input);
    assert.doesNotMatch(output, /###/);
    assert.match(output, /^How to decide$/m);
    assert.match(output, /1\. Pick based on interest\./);
  });

  test('formats screenshot-like branch guidance sample', () => {
    const input = [
      '| Branch | Why it can be a good choice for you | What you will learn |',
      '| --- | --- | --- |',
      '| Computer Science Engineering (CSE) | Good for software jobs. <br>• Good for startups | Coding, algorithms, software development |',
      '',
      '### How to decide',
      '',
      '1. Think about your interests.',
    ].join('\n');

    const output = formatForWhatsApp(input);
    assert.doesNotMatch(output, /\|/);
    assert.doesNotMatch(output, /###/);
    assert.doesNotMatch(output, /<br/i);
    assert.match(output, /Computer Science Engineering \(CSE\)/);
    assert.match(output, /How to decide/);
  });
});
