'use strict';

const { afterEach, describe, mock, test } = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../services/chatbot/humanCopilot/humanCopilotLearningService');
const handoffModelPath = require.resolve('../models/WhatsAppAgentHandoff');

describe('humanCopilotLearningService', () => {
  afterEach(() => {
    mock.restoreAll();
    delete require.cache[servicePath];
  });

  test('unchanged replies have zero ratio and unchanged classification', () => {
    const {
      normalizedEditRatio,
      classifyEditRatio,
      enrichReplyLearning,
    } = require(servicePath);

    const text = 'College X is suitable for your profile.';
    assert.equal(normalizedEditRatio(text, text), 0);
    assert.equal(classifyEditRatio(0), 'unchanged');
    const result = enrichReplyLearning({
      suggestedText: text,
      draftText: text,
      replySource: 'ai_used',
    });
    assert.equal(result.editClassification, 'unchanged');
    assert.equal(result.editRatio, 0);
  });

  test('minor edits classify below thirty percent change', () => {
    const { enrichReplyLearning } = require(servicePath);
    const suggested = 'abcdefghij';
    const finalText = 'abcdefghixy';
    const result = enrichReplyLearning({
      suggestedText: suggested,
      draftText: finalText,
      replySource: 'ai_edited',
    });
    assert.equal(result.editClassification, 'minor_edit');
    assert.ok(result.editRatio > 0.1);
    assert.ok(result.editRatio <= 0.3);
  });

  test('moderate edits classify between thirty and sixty percent', () => {
    const { enrichReplyLearning } = require(servicePath);
    const suggested = 'College X is suitable for your profile.';
    const finalText = 'College X may be suitable for your profile and hostel.';
    const result = enrichReplyLearning({
      suggestedText: suggested,
      draftText: finalText,
      replySource: 'ai_edited',
    });
    assert.equal(result.editClassification, 'moderate_edit');
    assert.ok(result.editRatio > 0.3);
    assert.ok(result.editRatio <= 0.6);
    assert.ok(result.editPatterns.includes('added_explanations'));
  });

  test('major rewrites classify above sixty percent', () => {
    const { enrichReplyLearning } = require(servicePath);
    const suggested = 'College X is suitable.';
    const finalText =
      'Let us review your rank, budget, hostel needs, and branch preferences before shortlisting colleges.';
    const result = enrichReplyLearning({
      suggestedText: suggested,
      draftText: finalText,
      replySource: 'ai_edited',
    });
    assert.equal(result.editClassification, 'major_rewrite');
    assert.ok(result.editRatio > 0.6);
  });

  test('manual replies store manual classification and null ratio', () => {
    const { enrichReplyLearning } = require(servicePath);
    const result = enrichReplyLearning({
      suggestedText: null,
      draftText: 'I will call you shortly.',
      replySource: 'manual',
    });
    assert.equal(result.editClassification, 'manual');
    assert.equal(result.editRatio, null);
    assert.deepEqual(result.editPatterns, []);
  });

  test('topic extraction maps common counselling topics', () => {
    const { extractEditTopic } = require(servicePath);
    assert.equal(extractEditTopic('Tell me about scholarship options'), 'scholarship');
    assert.equal(extractEditTopic('What are the fees and budget?'), 'fees');
    assert.equal(extractEditTopic('Need hostel accommodation details'), 'hostel');
    assert.equal(extractEditTopic('Hello there'), 'general');
  });

  test('empty data returns zero-filled overview', async () => {
    const WhatsAppAgentHandoff = require(handoffModelPath);
    mock.method(WhatsAppAgentHandoff, 'aggregate', async () => []);

    const { getLearningOverview } = require(servicePath);
    const result = await getLearningOverview({ sinceDays: 30 });
    assert.equal(result.data.totalSent, 0);
    assert.equal(result.data.aiUsedPercent, 0);
    assert.equal(result.data.editBreakdown.minorEdit, 0);
  });

  test('mixed dataset aggregates overview topics and examples', async () => {
    const WhatsAppAgentHandoff = require(handoffModelPath);
    const sentAt = new Date('2026-06-10T10:00:00Z');
    mock.method(WhatsAppAgentHandoff, 'aggregate', async () => [
      {
        handoffId: 'h1',
        productLine: 'iit_counselling',
        reply: {
          replySource: 'ai_edited',
          suggestedText: 'College X is suitable.',
          draftText:
            'Based on your rank and budget, College X may be suitable. I recommend hostel review.',
          status: 'sent',
          sentAt,
          editClassification: 'moderate_edit',
          editRatio: 0.45,
          editTopic: 'college_selection',
          editPatterns: ['added_explanations', 'softened_wording'],
        },
      },
      {
        handoffId: 'h2',
        productLine: 'guidexpert',
        reply: {
          replySource: 'ai_used',
          suggestedText: 'Scholarship details are available.',
          draftText: 'Scholarship details are available.',
          status: 'sent',
          sentAt: new Date('2026-06-09T10:00:00Z'),
        },
      },
      {
        handoffId: 'h3',
        productLine: 'guidexpert',
        reply: {
          replySource: 'manual',
          suggestedText: null,
          draftText: 'Calling you now.',
          status: 'sent',
          sentAt: new Date('2026-06-08T10:00:00Z'),
        },
      },
    ]);

    const {
      getLearningOverview,
      getLearningTopics,
      getLearningExamples,
      getLearningEditPatterns,
    } = require(servicePath);

    const overview = await getLearningOverview({ sinceDays: 30 });
    assert.equal(overview.data.totalSent, 3);
    assert.equal(overview.data.editBreakdown.moderateEdit, 1);
    assert.equal(overview.data.editBreakdown.unchanged, 1);

    const topics = await getLearningTopics({ sinceDays: 30 });
    assert.ok(topics.data.topics.some((topic) => topic.key === 'college_selection'));

    const patterns = await getLearningEditPatterns({ sinceDays: 30 });
    assert.ok(patterns.data.patterns.some((row) => row.key === 'added_explanations'));

    const examples = await getLearningExamples({ sinceDays: 30, limit: 5 });
    assert.equal(examples.data.examples.length, 2);
    assert.equal(examples.data.examples[0].editClassification, 'moderate_edit');
  });
});
