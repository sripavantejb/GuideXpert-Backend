'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { validateAiResponse } = require('../services/chatbot/aiGuardrailService');
const { validateCounsellorProgramResponse } = require('../services/chatbot/counsellorProgram/counsellorProgramGuardrailService');
const { getGuideXpertIdentityFaqAnswer } = require('../config/chatbotFaq');

const IDENTITY_QUESTIONS = [
  'What is GuideXpert?',
  'Tell me about GuideXpert.',
  'I want to know about GuideXpert.',
];

const knowledgeResults = [
  {
    id: 201,
    category: 'guidexpert',
    question: 'What is GuideXpert? What exactly do we do?',
    answer: 'GuideXpert helps students make the right career decisions.',
  },
];

describe('GuideXpert identity guardrail safety net', () => {
  test('identity questions return grounded FAQ instead of unsupported fallback', () => {
    const faqAnswer = getGuideXpertIdentityFaqAnswer();
    for (const userMessage of IDENTITY_QUESTIONS) {
      const kaResult = validateAiResponse({
        response: "I don't currently have verified information about that topic. Please contact the GuideXpert counselling team for accurate guidance.",
        knowledgeResults,
        userMessage,
        englishUserMessage: userMessage,
      });
      assert.ok(
        !/don't currently have verified information/i.test(kaResult.text),
        userMessage
      );
      assert.ok(kaResult.text.length > 20, userMessage);

      const cpaResult = validateCounsellorProgramResponse({
        response: '',
        knowledgeResults,
        faqHits: [{ slug: 'what-is-guidexpert', title: 'What is GuideXpert?', answer: faqAnswer }],
        userMessage,
        englishUserMessage: userMessage,
      });
      assert.equal(cpaResult.text, faqAnswer, userMessage);
    }
  });
});
