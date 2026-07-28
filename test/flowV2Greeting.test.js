'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  handleGreetingEntry,
  handleGreetingReply,
  handleEntrySideTrackReply,
  QUALIFICATION_ROWS,
  UNKNOWN_NAME_GREETING,
  NAME_REASK,
  NEUTRAL_QUALIFICATION_LINE,
  buildNodeEOpenBody,
} = require('../services/chatbot/flowV2/nodes/greeting');
const { emptyFlowV2Profile } = require('../constants/careerCounsellingFlowV2Profile');

const EXPECTED_TITLES = [
  '10th Completed',
  '11th Studying',
  '12th Completed (PCM)',
  '12th Completed (PCB)',
  '12th Completed (Commerce)',
  '12th Completed (Arts)',
  'Diploma',
  'Degree',
  'Drop Year',
  'Other',
];

describe('flowV2 greeting — Node E entry', () => {
  test('known profile.name opens desk greeting + 10-row qualification list (never asks name)', () => {
    const profile = { ...emptyFlowV2Profile(), name: 'Rahul' };
    const result = handleGreetingEntry({ flowV2: { profile } });
    assert.equal(result.replyText, null);
    assert.equal(
      result.interactive.body,
      "Hey Rahul! 👋\n\nI'm Rithika, from GuideXpert's counselling desk. We help students find a college that actually fits them — not just the ones with the biggest ads.\n\nTakes about 2 minutes, and it's free.\n\nFirst — where are you right now?"
    );
    assert.equal(result.interactive.body, buildNodeEOpenBody('Rahul'));
    assert.equal(result.contextPatch.stage, 'greeting_awaiting_qualification');
    assert.equal(result.interactive.type, 'list');
    assert.equal(result.interactive.buttonText, 'Choose your stage');
    assert.equal(result.interactive.sections[0].title, 'Your stage');
    assert.equal(result.interactive.sections[0].rows.length, 10);
    assert.deepEqual(
      result.interactive.sections[0].rows.map((r) => r.title),
      EXPECTED_TITLES
    );
    assert.deepEqual(
      QUALIFICATION_ROWS.map((row) => row.title),
      EXPECTED_TITLES
    );
  });

  test('CRM leadContext name seeds the greeting without a name ask', () => {
    const result = handleGreetingEntry({
      flowV2: { profile: emptyFlowV2Profile() },
      leadContext: { gx: { fullName: 'Arjun Sharma' } },
    });
    assert.equal(result.contextPatch.profile.name, 'Arjun');
    assert.equal(result.interactive.body, buildNodeEOpenBody('Arjun'));
    assert.equal(result.contextPatch.stage, 'greeting_awaiting_qualification');
  });

  test('known name plus known qualification skips Node E list and routes immediately to B2 GOAL', () => {
    const profile = {
      ...emptyFlowV2Profile(),
      name: 'Priya',
      qualification: '12th Completed (PCM)',
      stream: 'PCM',
    };
    const result = handleGreetingEntry({ flowV2: { profile } });
    assert.equal(result.contextPatch.stage, 'b2_goal_awaiting_reply');
    assert.equal(result.interactive.type, 'button');
    assert.equal(result.interactive.buttons.length, 3);
    assert.match(result.interactive.body, /What are you mainly trying to figure out/i);
  });

  test('unknown name still opens qualification list immediately (never asks for name)', () => {
    const result = handleGreetingEntry({});
    assert.equal(result.replyText, null);
    assert.equal(result.interactive.body, UNKNOWN_NAME_GREETING);
    assert.equal(result.interactive.body, buildNodeEOpenBody(null));
    assert.match(result.interactive.body, /^Hi! 👋/);
    assert.match(result.interactive.body, /First — where are you right now\?/);
    assert.doesNotMatch(result.interactive.body, /May I know your name/i);
    assert.equal(result.interactive.type, 'list');
    assert.equal(result.interactive.buttonText, 'Choose your stage');
    assert.equal(result.contextPatch.stage, 'greeting_awaiting_qualification');
    assert.equal(result.interactive.sections[0].rows.length, 10);
  });

  test('hi with no name opens the 10-row qualification list in one turn', async () => {
    const { processFlowV2Turn } = require('../services/chatbot/flowV2/flowV2Dispatcher');
    const open = await processFlowV2Turn({ flowV2: { stage: null, profile: null } }, 'hi');
    assert.equal(open.replyText, null);
    assert.equal(open.interactive.type, 'list');
    assert.equal(open.interactive.body, UNKNOWN_NAME_GREETING);
    assert.equal(open.contextPatch.stage, 'greeting_awaiting_qualification');
    assert.deepEqual(
      open.interactive.sections[0].rows.map((row) => row.title),
      EXPECTED_TITLES
    );
  });

  test('is a defensive no-op if called with a stage already set (belt-and-suspenders; real guarantee is at dispatcher level)', () => {
    const result = handleGreetingEntry({ flowV2: { stage: 'greeting_awaiting_name' } });
    assert.equal(result.replyText, null);
    assert.equal(result.interactive, null);
  });
});

describe('flowV2 greeting — legacy name capture (greeting_awaiting_name only)', () => {
  const nameCtx = (patch = {}) => ({
    flowV2: { stage: 'greeting_awaiting_name', profile: emptyFlowV2Profile(), nameAttempts: 0, ...patch },
  });

  test('extracts names from emoji, short, and long conversational replies', () => {
    for (const [text, expected] of [
      ['😊 Rahul', 'Rahul'],
      ['Ananya', 'Ananya'],
      ["Hi Rithika! My name is mohammed, I'm looking for college advice 😊", 'Mohammed'],
    ]) {
      const result = handleGreetingReply(nameCtx(), text);
      assert.equal(result.contextPatch.profile.name, expected);
      assert.equal(result.contextPatch.stage, 'greeting_awaiting_qualification');
      assert.equal(result.interactive.body, buildNodeEOpenBody(expected));
    }
  });

  test('unclear first reply gets exact re-ask; unclear second reply never asks a third time', () => {
    const first = handleGreetingReply(nameCtx(), '🤷');
    assert.equal(first.replyText, NAME_REASK);
    assert.equal(first.replyText, "Sorry, didn't catch that 😊 What should I call you?");
    assert.equal(first.contextPatch.nameAttempts, 1);

    const second = handleGreetingReply(nameCtx({ nameAttempts: 1 }), '...');
    assert.equal(second.interactive.body, NEUTRAL_QUALIFICATION_LINE);
    assert.equal(second.interactive.body, 'First — where are you right now?');
    assert.equal(second.contextPatch.stage, 'greeting_awaiting_qualification');
    assert.equal(second.contextPatch.nameAttempts, null);
  });

  test('name attempts remain ephemeral and accepted name preserves existing profile fields', () => {
    const existing = { ...emptyFlowV2Profile(), branchInterest: 'ECE', cityPref: 'Pune' };
    const result = handleGreetingReply(nameCtx({ profile: existing, nameAttempts: 1 }), 'I am Kavya 😊');
    assert.equal(result.contextPatch.profile.name, 'Kavya');
    assert.equal(result.contextPatch.profile.branchInterest, 'ECE');
    assert.equal(result.contextPatch.profile.cityPref, 'Pune');
    assert.equal('nameAttempts' in result.contextPatch.profile, false);
    assert.equal(result.contextPatch.nameAttempts, null);
  });
});

describe('flowV2 greeting — qualification routes', () => {
  function qualCtx(profilePatch = {}) {
    return {
      flowV2: {
        stage: 'greeting_awaiting_qualification',
        profile: { ...emptyFlowV2Profile(), name: 'Rahul', ...profilePatch },
      },
    };
  }

  test('PCM follows the default B2 GOAL path and preserves unrelated profile data', () => {
    const result = handleGreetingReply(qualCtx({ cityPref: 'Hyderabad' }), '12th Completed (PCM)');
    assert.equal(result.contextPatch.profile.qualification, '12th Completed (PCM)');
    assert.equal(result.contextPatch.profile.stream, 'PCM');
    assert.equal(result.contextPatch.profile.cityPref, 'Hyderabad');
    assert.equal(result.contextPatch.stage, 'b2_goal_awaiting_reply');
    assert.equal(result.interactive.type, 'button');
    assert.equal(result.interactive.buttons.length, 3);
    assert.match(result.interactive.body, /What are you mainly trying to figure out/i);
  });

  test('all non-PCM list rows enter their required side tracks', () => {
    const expectedStages = {
      '10th Completed': 'entry_class10_awaiting_reply',
      '11th Studying': 'entry_class11_awaiting_reply',
      '12th Completed (PCB)': 'entry_pcb_awaiting_reply',
      '12th Completed (Commerce)': 'entry_commerce_awaiting_reply',
      '12th Completed (Arts)': 'entry_arts_honest_scope',
      Diploma: 'entry_diploma_awaiting_reply',
      Degree: 'entry_degree_awaiting_reply',
      'Drop Year': 'entry_drop_year_awaiting_reply',
      Other: 'entry_other_awaiting_text',
    };
    for (const [qualification, stage] of Object.entries(expectedStages)) {
      const result = handleGreetingReply(qualCtx(), qualification);
      assert.equal(result.contextPatch.profile.qualification, qualification);
      assert.equal(result.contextPatch.stage, stage, qualification);
    }
  });

  test('Class 10 parks in stream advice without entering college shortlisting', () => {
    const profile = { ...emptyFlowV2Profile(), qualification: '10th Completed' };
    const result = handleEntrySideTrackReply(
      { flowV2: { stage: 'entry_class10_awaiting_reply', profile } },
      'Just exploring'
    );
    assert.equal(result.contextPatch.stage, 'entry_class10_stream_advice_parked');
    assert.match(result.replyText, /not shortlisting colleges/i);
  });

  test('Class 11, PCB tech, Diploma, Degree, and Drop Year rejoin B2 GOAL with route data', () => {
    const base = emptyFlowV2Profile();
    const cases = [
      ['entry_class11_awaiting_reply', { ...base, qualification: '11th Studying', timeline: 'next_year' }, 'Both'],
      ['entry_pcb_awaiting_reply', { ...base, qualification: '12th Completed (PCB)' }, 'Open to tech'],
      ['entry_diploma_awaiting_reply', { ...base, qualification: 'Diploma' }, 'Yes, lateral entry'],
      ['entry_degree_awaiting_reply', { ...base, qualification: 'Degree' }, 'After graduation'],
      ['entry_drop_year_awaiting_reply', { ...base, qualification: 'Drop Year', entryType: 'dropper' }, 'Both'],
    ];
    for (const [stage, profile, answer] of cases) {
      const result = handleEntrySideTrackReply({ flowV2: { stage, profile } }, answer);
      assert.equal(result.contextPatch.stage, 'b2_goal_awaiting_reply', stage);
      assert.equal(result.interactive.type, 'button', stage);
      assert.equal(result.interactive.buttons.length, 3, stage);
    }
    const diploma = handleEntrySideTrackReply(
      { flowV2: { stage: 'entry_diploma_awaiting_reply', profile: cases[2][1] } },
      'Yes, lateral entry'
    );
    assert.equal(diploma.contextPatch.profile.entryType, 'lateral');
  });

  test('Commerce prefilters the branch but uses the honest-scope route because no verified business catalog exists', () => {
    const commerce = handleEntrySideTrackReply(
      {
        flowV2: {
          stage: 'entry_commerce_awaiting_reply',
          profile: { ...emptyFlowV2Profile(), qualification: '12th Completed (Commerce)' },
        },
      },
      'Design'
    );
    assert.equal(commerce.contextPatch.stage, 'entry_commerce_honest_scope');
    assert.equal(commerce.contextPatch.profile.stream, 'Commerce');
    assert.equal(commerce.contextPatch.profile.branchInterest, 'design');
    assert.match(commerce.interactive.body, /won't mix in or invent/i);
  });

  test('PCB medical and Arts use honest scope routes; Other captures free text and reroutes', () => {
    const pcb = handleEntrySideTrackReply(
      {
        flowV2: {
          stage: 'entry_pcb_awaiting_reply',
          profile: { ...emptyFlowV2Profile(), qualification: '12th Completed (PCB)' },
        },
      },
      'Medical'
    );
    assert.equal(pcb.contextPatch.stage, 'entry_pcb_medical_scope');
    assert.match(pcb.interactive.body, /rather not guess at medical admissions/i);

    const arts = handleGreetingReply(qualCtx(), '12th Completed (Arts)');
    assert.equal(arts.contextPatch.stage, 'entry_arts_honest_scope');
    assert.equal(arts.contextPatch.profile.stream, 'Arts');
    assert.match(arts.interactive.body, /rather not guess at Arts pathways/i);

    const other = handleEntrySideTrackReply(
      {
        flowV2: {
          stage: 'entry_other_awaiting_text',
          profile: { ...emptyFlowV2Profile(), qualification: 'Other' },
        },
      },
      'I am pursuing my degree'
    );
    assert.equal(other.contextPatch.profile.qualification, 'Degree');
    assert.equal(other.contextPatch.stage, 'entry_degree_awaiting_reply');
  });

  test('honest-scope "tell me about tech" choices rejoin B2 GOAL, while Class 10 remains parked', () => {
    const artsProfile = {
      ...emptyFlowV2Profile(),
      qualification: '12th Completed (Arts)',
      stream: 'Arts',
    };
    const tech = handleEntrySideTrackReply(
      { flowV2: { stage: 'entry_arts_honest_scope', profile: artsProfile } },
      'Tell me about tech anyway'
    );
    assert.equal(tech.contextPatch.stage, 'b2_goal_awaiting_reply');
    assert.equal(tech.interactive.type, 'button');
    assert.equal(tech.interactive.buttons.length, 3);

    const class10 = handleEntrySideTrackReply(
      {
        flowV2: {
          stage: 'entry_class10_stream_advice_parked',
          profile: { ...emptyFlowV2Profile(), qualification: '10th Completed' },
        },
      },
      'show me colleges'
    );
    assert.equal(class10.contextPatch.stage, 'entry_class10_stream_advice_parked');
    assert.match(class10.replyText, /College shortlisting can wait/i);
  });
});
