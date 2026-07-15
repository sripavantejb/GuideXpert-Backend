'use strict';

/**
 * JEE Counselling sticky journey (Main + Advanced).
 * currentJourney = JEE_COUNSELLING via context.jeeCounsellingActive.
 * Routes through IIT Counselling Expert for JoSAA/rank guidance — routing only, no RAG.
 */

const { normalizeText } = require('../intentTextUtils');
const { isIitCounsellingExpertEnabled } = require('../iitCounsellingExpert/iitCounsellingFlags');
const {
  isIitCounsellingExpertSessionActive,
  isIitCounsellingExpertQuestion,
  isIitCounsellingEntryRequest,
  isIitCounsellingInSessionTopic,
  resolveIitContextExpansion,
} = require('../iitCounsellingExpert/iitCounsellingIntentService');

const JEE_SESSION_EXIT_RE =
  /^(main menu|menu|home|restart|start over|start again|cancel|exit|quit|bye|goodbye|good bye|see you|talk later)$/i;

/** Advanced → ICE (IIT path). */
const JEE_ADVANCED_ENTRY_RE =
  /\b(jee\s*advanc(ed)?|i wrote (jee )?advanc(ed)?|i qualified (jee )?advanc(ed)?|cleared (jee )?advanc(ed)?|advanc(ed)? result|need iit admission)\b/i;

/** Main → JEE Main journey (still ICE handler with main track). */
const JEE_MAIN_ENTRY_RE =
  /\b(jee\s*mains?|i wrote jee mains?|cleared jee mains?|main result|need nit counselling|need nit guidance|help me with jee mains?)\b/i;

/** Ambiguous JEE — ask Main vs Advanced. */
const JEE_AMBIGUOUS_ENTRY_RE =
  /^(jee|help me with jee|jee counselling|jee counseling|need jee guidance|need jee counselling|need jee counseling|i cleared jee|i wrote jee)\s*[.!?]?$/i;

const COMMERCE_OOS_RE =
  /\b(amazon|flipkart|myntra|meesho|shopping|shop on|buy (a |an |the )?(laptop|phone|iphone|macbook)|purchase|place an order|order (on|from)|discount code|best price for)\b/i;

function isJeeSessionExitRequest(text, originalText = null) {
  return [normalizeText(text), normalizeText(originalText || '')]
    .filter(Boolean)
    .some((t) => JEE_SESSION_EXIT_RE.test(t));
}

function isJeeCounsellingSessionActive(botState) {
  return (
    Boolean(botState?.context?.jeeCounsellingActive) ||
    isIitCounsellingExpertSessionActive(botState)
  );
}

function isJeeAdvancedEntry(text, originalText = null) {
  return [normalizeText(text), normalizeText(originalText || '')]
    .filter(Boolean)
    .some((t) => JEE_ADVANCED_ENTRY_RE.test(t));
}

function isJeeMainEntry(text, originalText = null) {
  if (isJeeAdvancedEntry(text, originalText)) return false;
  return [normalizeText(text), normalizeText(originalText || '')]
    .filter(Boolean)
    .some((t) => JEE_MAIN_ENTRY_RE.test(t));
}

function isJeeAmbiguousEntry(text, originalText = null) {
  if (isJeeAdvancedEntry(text, originalText) || isJeeMainEntry(text, originalText)) return false;
  return [normalizeText(text), normalizeText(originalText || '')]
    .filter(Boolean)
    .some((t) => JEE_AMBIGUOUS_ENTRY_RE.test(t));
}

function isCommerceOutOfScopeRequest(text, originalText = null) {
  const hay = `${text || ''} ${originalText || ''}`.toLowerCase();
  // JoSAA seat-acceptance fee language is not commerce shopping.
  if (/\b(josaa|seat acceptance|counselling fee|counseling fee|saf)\b/i.test(hay)) return false;
  return COMMERCE_OOS_RE.test(hay);
}

function resolveJeeExamTrack(text, originalText = null) {
  if (isJeeAdvancedEntry(text, originalText)) return 'advanced';
  if (isJeeMainEntry(text, originalText)) return 'main';
  if (isJeeAmbiguousEntry(text, originalText)) return 'clarify';
  return null;
}

/**
 * Broader JEE vocabulary owned while journey active (and cold-start on iit product line).
 * Includes reservation / eligibility / gender quota from Section C V2.
 */
function isJeeInSessionTopic(text, originalText = null) {
  if (isIitCounsellingInSessionTopic(text, originalText)) return true;
  return [normalizeText(text), normalizeText(originalText || '')].filter(Boolean).some((t) => {
    if (!t) return false;
    if (
      /^(exam|main|advanced|nta|marks?|percentile|eligibility|reservation|reservation policy|quota|age limit|maximum age|attempt limits?|attempts?|drop year|gap year|minority|female quota|gender quota|other state|why are there two exams|can everyone write|can i write again|who can write)\s*[.!?]?$/i.test(
        t
      )
    ) {
      return true;
    }
    if (
      /^(general|obc|sc|st|ews|pwd)\s*(female|girl|woman|women)?\s*[.!?]?$/i.test(t) ||
      /^(female|girl)\s*(general|obc|sc|st|ews)?\s*[.!?]?$/i.test(t)
    ) {
      return true;
    }
    if (/\b(reservation|age limit|attempt limit|eligibility|home state|other state)\b/i.test(t)) {
      return true;
    }
    if (
      /\b(difference between (jee )?main and (jee )?advanced|who conducts jee|write advanced without main|two exams)\b/i.test(
        t
      )
    ) {
      return true;
    }
    if (
      /\b(can i get (iit|nit|iiit)|any better colleges|what about iiit|best option|iiit or nit|better branch)\b/i.test(
        t
      )
    ) {
      return true;
    }
    return false;
  });
}

function resolveJeeContextExpansion(text, originalText = null) {
  const fromIit = resolveIitContextExpansion(text, originalText);
  if (fromIit) return fromIit;

  for (const candidate of [normalizeText(text), normalizeText(originalText || '')].filter(Boolean)) {
    const rows = [
      {
        re: /^age limit\s*[.!?]?$/i,
        text: 'What is the age limit / maximum age for JEE Main and JEE Advanced eligibility?',
      },
      {
        re: /^attempt limits?\s*[.!?]?$/i,
        text: 'What is the attempt limit for JEE Main and JEE Advanced?',
      },
      {
        re: /^attempts?\s*[.!?]?$/i,
        text: 'How many attempts are allowed for JEE Main and JEE Advanced?',
      },
      { re: /^eligibility\s*[.!?]?$/i, text: 'Who is eligible for JEE Main and JEE Advanced?' },
      {
        re: /^reservation( policy)?\s*[.!?]?$/i,
        text: 'Explain the reservation policy for JEE / JoSAA counselling (OBC, SC, ST, EWS, PwD, female).',
      },
      {
        re: /^(obc|sc|st|ews|pwd)\s*reservation\s*[.!?]?$/i,
        text: 'Explain reservation for that category in JEE / JoSAA counselling.',
      },
      {
        re: /^(general|obc|sc|st|ews|pwd)\s*female\s*[.!?]?$/i,
        text: 'How does category + female / gender seat quota work in JoSAA counselling?',
      },
      {
        re: /^female quota\s*[.!?]?$/i,
        text: 'What is female / gender-based quota in JoSAA / IIT-NIT counselling?',
      },
      { re: /^other state\s*[.!?]?$/i, text: 'What is other state quota in JoSAA counselling?' },
      { re: /^exam\s*[.!?]?$/i, text: 'Do you mean JEE Main or JEE Advanced?' },
      {
        re: /^main\s*[.!?]?$/i,
        text: 'Tell me about JEE Main exam, eligibility, and counselling path for NITs/IIITs.',
      },
      {
        re: /^advanced\s*[.!?]?$/i,
        text: 'Tell me about JEE Advanced exam, eligibility, and IIT counselling via JoSAA.',
      },
      { re: /^nta\s*[.!?]?$/i, text: 'What is the role of NTA in JEE Main?' },
      {
        re: /^why are there two exams\??$/i,
        text: 'Why are there two exams — JEE Main and JEE Advanced?',
      },
      {
        re: /^can everyone write\??$/i,
        text: 'Can everyone write JEE Advanced, or what are the eligibility rules?',
      },
      {
        re: /^can i write again\??$/i,
        text: 'Can I write JEE Main or Advanced again — what are the attempt rules?',
      },
      {
        re: /^who can write\??$/i,
        text: 'Who is eligible to write JEE Main and JEE Advanced?',
      },
      {
        re: /^drop year\s*[.!?]?$/i,
        text: 'How does a drop year / gap year affect JEE Main and Advanced eligibility and attempts?',
      },
      {
        re: /^gap year\s*[.!?]?$/i,
        text: 'How does a gap year affect JEE eligibility and attempts?',
      },
      {
        re: /^can i get nit\??$/i,
        text: 'Can I get an NIT with my JEE Main rank? Ask for AIR and category if needed.',
      },
      {
        re: /^can i get iiit\??$/i,
        text: 'Can I get an IIIT with my JEE Main rank? Ask for AIR and category if needed.',
      },
      {
        re: /^any better colleges\??$/i,
        text: 'Given my JEE rank and category, what are better college options among NITs/IIITs/GFTIs?',
      },
      {
        re: /^what about iiit\??$/i,
        text: 'What about IIIT options for my JEE rank and category?',
      },
    ];
    for (const row of rows) {
      if (row.re.test(candidate)) return row.text;
    }
    let m = candidate.match(/^(general|obc|sc|st|ews|pwd)\s+(female)\s*[.!?]?$/i);
    if (m) {
      return `How does ${m[1]} + female quota affect JoSAA / JEE counselling seat chances?`;
    }
  }
  return null;
}

function shouldDeferFoundationForJee(text, originalText, botState, productLine = null) {
  if (!isIitCounsellingExpertEnabled()) return false;
  if (isJeeSessionExitRequest(text, originalText)) return false;
  if (isCommerceOutOfScopeRequest(text, originalText)) return false;
  if (isJeeCounsellingSessionActive(botState)) {
    const t = normalizeText(text);
    if (/^(english|hindi|telugu|తెలుగు|हिंदी|தமிழ்)$/i.test(t)) return false;
    if (/\b(switch to|change language|language please)\b/i.test(t)) return false;
    return true;
  }
  if (
    isJeeMainEntry(text, originalText) ||
    isJeeAdvancedEntry(text, originalText) ||
    isJeeAmbiguousEntry(text, originalText)
  ) {
    return true;
  }
  if (isJeeInSessionTopic(text, originalText)) {
    return productLine === 'iit_counselling' || isIitCounsellingExpertQuestion(text, originalText);
  }
  return false;
}

function shouldBypassScopeFirewallForJee(botState, text, originalText, intent) {
  if (!isIitCounsellingExpertEnabled()) return false;
  if (isCommerceOutOfScopeRequest(text, originalText)) return false;
  if (isJeeSessionExitRequest(text, originalText)) return false;

  const sessionActive = isJeeCounsellingSessionActive(botState);
  const jeeIntent =
    intent === 'iit_counselling_expert' ||
    intent === 'iit_counselling_strategy' ||
    intent === 'jee_exam_clarify' ||
    intent === 'jee_main_counselling';

  if (!sessionActive && !jeeIntent) return false;

  const hay = `${text || ''} ${originalText || ''}`.toLowerCase();
  if (
    /\b(python|javascript|ipl|cricket|movie|bollywood|politics|weather|bitcoin|crypto|amazon|flipkart|shopping)\b/i.test(
      hay
    ) ||
    /\b(teach me|write (a |some )?code|who won)\b/i.test(hay)
  ) {
    return false;
  }

  if (sessionActive && isJeeInSessionTopic(text, originalText)) return true;
  if (sessionActive && jeeIntent) return true;
  if (
    jeeIntent &&
    (isJeeInSessionTopic(text, originalText) ||
      isIitCounsellingExpertQuestion(text, originalText) ||
      isIitCounsellingEntryRequest(text, originalText) ||
      isJeeMainEntry(text, originalText) ||
      isJeeAdvancedEntry(text, originalText) ||
      isJeeAmbiguousEntry(text, originalText))
  ) {
    return true;
  }
  if (intent === 'iit_counselling_strategy' && !isCommerceOutOfScopeRequest(text, originalText)) {
    return true;
  }
  return false;
}

function resolveJeeSessionTurn({
  text,
  originalText = null,
  botState = null,
  intent = null,
  productLine = null,
} = {}) {
  const expansion = resolveJeeContextExpansion(text, originalText);
  const track = resolveJeeExamTrack(text, originalText);
  const sessionActive = isJeeCounsellingSessionActive(botState);
  const exitSession = isJeeSessionExitRequest(text, originalText);
  return {
    sessionActive,
    exitSession,
    expandedText: expansion,
    expansionReason: expansion ? 'jee_context_resolver' : null,
    examTrack: track,
    deferFoundation: shouldDeferFoundationForJee(text, originalText, botState, productLine),
    bypassScope: shouldBypassScopeFirewallForJee(botState, text, originalText, intent),
    commerceOos: isCommerceOutOfScopeRequest(text, originalText),
    routeToIce:
      !exitSession &&
      !isCommerceOutOfScopeRequest(text, originalText) &&
      (sessionActive ||
        isJeeMainEntry(text, originalText) ||
        isJeeAdvancedEntry(text, originalText) ||
        isJeeInSessionTopic(text, originalText) ||
        isIitCounsellingExpertQuestion(text, originalText)),
  };
}

const JEE_EXAM_CLARIFY_REPLY =
  'Did you write *JEE Main* or *JEE Advanced*?\n\n• Main → NIT / IIIT / GFTI counselling guidance\n• Advanced → IIT counselling via JoSAA\n\nReply with Main or Advanced and I will continue.';

module.exports = {
  isJeeSessionExitRequest,
  isJeeCounsellingSessionActive,
  isJeeAdvancedEntry,
  isJeeMainEntry,
  isJeeAmbiguousEntry,
  isCommerceOutOfScopeRequest,
  isJeeInSessionTopic,
  resolveJeeExamTrack,
  resolveJeeContextExpansion,
  shouldDeferFoundationForJee,
  shouldBypassScopeFirewallForJee,
  resolveJeeSessionTurn,
  JEE_EXAM_CLARIFY_REPLY,
};
