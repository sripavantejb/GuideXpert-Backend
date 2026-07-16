'use strict';

/**
 * Booking Support Router
 *
 * Exits early with deterministic CRM-backed replies.
 * Never invokes LLM, RAG, ICE, CPA, or ICS.
 */

const { normalizeLanguageCode } = require('../../../constants/languageConstants');
const { extractFirstName } = require('../welcomeMessageService');
const { bookingPageUrl } = require('./bookingContextResolver');
const {
  resolveBookingSupportIntent,
  isBookingSupportHandoffRequest,
} = require('./bookingSupportIntentService');

function pickLang(resolvedLanguage) {
  return normalizeLanguageCode(resolvedLanguage) || 'en';
}

function getBookingContext(leadContext) {
  return leadContext?.bookingContext || leadContext?.booking || null;
}

function noBookingReply(resolvedLanguage = 'en') {
  const lang = pickLang(resolvedLanguage);
  const url = bookingPageUrl();
  const templates = {
    en: [
      "I couldn't find an active counselling booking for this number.",
      '',
      'Please book your counselling session through the GuideXpert website:',
      url,
      '',
      'After booking, I can help you with:',
      '• booking status',
      '• meeting link',
      '• assigned counsellor',
      '• documents',
      '• session preparation',
      '',
      'Reply MENU for more options or AGENT to speak with our team.',
    ].join('\n'),
    hi: [
      'Is number ke liye active counselling booking nahin mili.',
      '',
      'Kripya GuideXpert website par apna counselling session book karein:',
      url,
      '',
      'Booking ke baad main aapki madad kar sakta hoon — status, meeting link, counsellor, documents aur preparation.',
      '',
      'MENU ya AGENT likhein.',
    ].join('\n'),
    te: [
      'ఈ నంబర్‌కు active counselling booking కనుగొనలేకపోయాము.',
      '',
      'GuideXpert website ద్వారా మీ counselling session book చేయండి:',
      url,
      '',
      'Booking తర్వాత నేను status, meeting link, counsellor, documents మరియు preparation లో సహాయం చేస్తాను.',
      '',
      'MENU లేదా AGENT అని reply చేయండి.',
    ].join('\n'),
  };
  return templates[lang] || templates.en;
}

function existingBookingCreateReply(resolvedLanguage = 'en', bookingContext = null) {
  const lang = pickLang(resolvedLanguage);
  const summary = buildBookingContextSummaryReply(resolvedLanguage, bookingContext);
  const websiteNote =
    lang === 'hi'
      ? '\n\nBadlav ke liye GuideXpert website booking portal use karein ya apne counsellor se sampark karein.'
      : lang === 'te'
        ? '\n\nమార్పుల కోసం GuideXpert website booking portal use చేయండి లేదా మీ counsellor ను సంప్రదించండి.'
        : '\n\nTo make changes, please use the GuideXpert website booking portal or contact your assigned counsellor.';
  return `I found an existing counselling booking.\n\n${summary}${websiteNote}`;
}

function bookingCreateCheckReply(resolvedLanguage = 'en', bookingContext = null) {
  if (bookingContext?.exists) {
    return existingBookingCreateReply(resolvedLanguage, bookingContext);
  }
  return noBookingReply(resolvedLanguage);
}

function rescheduleCancelReply(resolvedLanguage = 'en', bookingContext = null) {
  const lang = pickLang(resolvedLanguage);
  const url = bookingPageUrl();
  const counsellor = bookingContext?.assignedCounsellor;
  const counsellorLine = counsellor
    ? `Assigned counsellor: ${counsellor}`
    : 'You can also contact your assigned counsellor.';

  const templates = {
    en: [
      'Bookings are managed through the GuideXpert website.',
      '',
      'Please use the booking portal or contact your assigned counsellor.',
      url,
      counsellorLine,
      '',
      'Reply AGENT to connect with our support team or MENU for more options.',
    ].join('\n'),
    hi: [
      'Bookings GuideXpert website par manage hote hain.',
      '',
      'Kripya booking portal use karein ya apne counsellor se sampark karein.',
      url,
      counsellorLine,
      '',
      'Support ke liye AGENT ya MENU likhein.',
    ].join('\n'),
    te: [
      'Bookings GuideXpert website ద్వారా manage అవుతాయి.',
      '',
      'Booking portal use చేయండి లేదా మీ counsellor ను సంప్రదించండి.',
      url,
      counsellorLine,
      '',
      'Support కోసం AGENT లేదా MENU అని reply చేయండి.',
    ].join('\n'),
  };
  return templates[lang] || templates.en;
}

function buildBookingContextSummaryReply(resolvedLanguage = 'en', bookingContext = null) {
  if (!bookingContext?.exists) {
    return noBookingReply(resolvedLanguage);
  }

  const lang = pickLang(resolvedLanguage);
  const firstName = extractFirstName(bookingContext.fullName);
  const slot = bookingContext.sessionSlotLabel || '—';
  const when =
    bookingContext.sessionInstantLabel ||
    [bookingContext.sessionDate, bookingContext.sessionTime].filter(Boolean).join(' ') ||
    '—';
  const prefLang = bookingContext.preferredLanguage || '—';
  const counsellor = bookingContext.assignedCounsellor || '—';
  const status = bookingContext.demoStatusLabel || bookingContext.bookingStatus || '—';
  const meetingLink = bookingContext.meetingLink || '—';
  const bookingId = bookingContext.bookingId || '—';
  const college = bookingContext.preferredCollege || '—';
  const exam = bookingContext.exam || '—';
  const lifecycle = bookingContext.lifecycleStage || bookingContext.leadStatusLabel || '—';

  const templates = {
    en: {
      greeting: firstName ? `Hi ${firstName}!` : 'Hi there!',
      title: 'Here is your counselling booking summary:',
      session: 'Session',
      when: 'Date & Time (IST)',
      language: 'Language',
      counsellor: 'Assigned counsellor',
      status: 'Booking status',
      lifecycle: 'Lifecycle stage',
      college: 'College preference',
      exam: 'Registration details',
      bookingId: 'Booking ID',
      link: 'Meeting link',
      footer: 'Reply MENU for main menu or AGENT to speak with our team.',
    },
    te: {
      greeting: firstName ? `హాయ్ ${firstName}!` : 'హాయ్!',
      title: 'మీ counselling booking summary:',
      session: 'Session',
      when: 'తేదీ & సమయం (IST)',
      language: 'భాష',
      counsellor: 'Assigned counsellor',
      status: 'Booking status',
      lifecycle: 'Lifecycle stage',
      college: 'College preference',
      exam: 'Registration details',
      bookingId: 'Booking ID',
      link: 'Meeting link',
      footer: 'MENU లేదా AGENT అని reply చేయండి.',
    },
    hi: {
      greeting: firstName ? `नमस्ते ${firstName}!` : 'नमस्ते!',
      title: 'Yeh raha aapka counselling booking summary:',
      session: 'Session',
      when: 'Date & Time (IST)',
      language: 'Bhasha',
      counsellor: 'Assigned counsellor',
      status: 'Booking status',
      lifecycle: 'Lifecycle stage',
      college: 'College preference',
      exam: 'Registration details',
      bookingId: 'Booking ID',
      link: 'Meeting link',
      footer: 'MENU ya AGENT likhein.',
    },
  };

  const t = templates[lang] || templates.en;
  return [
    `${t.greeting} ${t.title}`,
    `• ${t.session}: ${slot}`,
    `• ${t.when}: ${when}`,
    `• ${t.language}: ${prefLang}`,
    `• ${t.counsellor}: ${counsellor}`,
    `• ${t.status}: ${status}`,
    `• ${t.lifecycle}: ${lifecycle}`,
    `• ${t.college}: ${college}`,
    `• ${t.exam}: ${exam}`,
    `• ${t.bookingId}: ${bookingId}`,
    '',
    `${t.link}:`,
    meetingLink,
    '',
    t.footer,
  ].join('\n');
}

function fieldNotSavedReply(resolvedLanguage, fieldLabel) {
  const lang = pickLang(resolvedLanguage);
  if (lang === 'hi') {
    return `${fieldLabel} aapke website booking form mein abhi save nahin hai. Portal par check karein ya AGENT likhein.`;
  }
  if (lang === 'te') {
    return `${fieldLabel} మీ website booking form లో ఇంకా save కాలేదు. Portal check చేయండి లేదా AGENT అని reply చేయండి.`;
  }
  return `${fieldLabel} is not saved on your website booking yet. Check the portal or reply AGENT for help.`;
}

function buildBookingFieldReply(resolvedLanguage, bookingContext, field) {
  if (!bookingContext?.exists) {
    return noBookingReply(resolvedLanguage);
  }

  const lang = pickLang(resolvedLanguage);
  const map = {
    session_time:
      bookingContext.sessionInstantLabel ||
      [bookingContext.sessionDate, bookingContext.sessionTime, bookingContext.sessionSlotLabel]
        .filter(Boolean)
        .join(' '),
    counsellor: bookingContext.assignedCounsellor,
    meeting_link: bookingContext.meetingLink,
    booking_status: bookingContext.bookingStatus,
    booking_id: bookingContext.bookingId,
    exam: bookingContext.exam,
    rank: bookingContext.rank,
    category: bookingContext.category,
    branch: bookingContext.preferredBranch,
    college: bookingContext.preferredCollege,
    lifecycle: bookingContext.lifecycleStage || bookingContext.leadStatusLabel,
  };

  const value = map[field];
  if (!value) {
    if (field === 'rank') return fieldNotSavedReply(resolvedLanguage, 'Rank');
    if (field === 'category') return fieldNotSavedReply(resolvedLanguage, 'Category');
    if (field === 'branch') return fieldNotSavedReply(resolvedLanguage, 'Branch preference');
    if (field === 'meeting_link' && !bookingContext.meetingLink) {
      return 'Meeting link is not available yet. Reply AGENT and our team will share it.';
    }
    if (field === 'counsellor' && !bookingContext.assignedCounsellor) {
      return 'Your assigned counsellor will be confirmed shortly. Reply AGENT for help.';
    }
    return noBookingReply(resolvedLanguage);
  }

  const labels = {
    en: {
      session_time: 'Your session is scheduled for',
      counsellor: 'Your assigned counsellor is',
      meeting_link: 'Your meeting link is',
      booking_status: 'Your booking status is',
      booking_id: 'Your booking ID is',
      exam: 'Your registration details',
      rank: 'Your submitted rank is',
      category: 'Your selected category is',
      branch: 'Your branch preference is',
      college: 'Your college preference is',
      lifecycle: 'Your lifecycle stage is',
    },
  };
  const label = (labels[lang] || labels.en)[field] || 'Details';
  return `${label}: ${value}\n\nReply MENU for more options or AGENT for support.`;
}

function buildDeterministicBookingReply({
  queryId,
  resolvedLanguage = 'en',
  bookingContext = null,
} = {}) {
  switch (queryId) {
    case 'session_when':
    case 'session_time':
    case 'session_join':
      return buildBookingFieldReply(resolvedLanguage, bookingContext, 'session_time');
    case 'booking_status':
      return buildBookingFieldReply(resolvedLanguage, bookingContext, 'booking_status');
    case 'booking_summary':
    case 'menu_summary':
    case 'session_summary':
      return buildBookingContextSummaryReply(resolvedLanguage, bookingContext);
    case 'counsellor':
      return buildBookingFieldReply(resolvedLanguage, bookingContext, 'counsellor');
    case 'meeting_link':
      return buildBookingFieldReply(resolvedLanguage, bookingContext, 'meeting_link');
    case 'exam':
      return buildBookingFieldReply(resolvedLanguage, bookingContext, 'exam');
    case 'rank':
      return buildBookingFieldReply(resolvedLanguage, bookingContext, 'rank');
    case 'category':
      return buildBookingFieldReply(resolvedLanguage, bookingContext, 'category');
    case 'branch':
      return buildBookingFieldReply(resolvedLanguage, bookingContext, 'branch');
    case 'college':
      return buildBookingFieldReply(resolvedLanguage, bookingContext, 'college');
    case 'prep':
    case 'documents':
      return [
        buildBookingContextSummaryReply(resolvedLanguage, bookingContext),
        '',
        'For session preparation and documents, your assigned counsellor will guide you during the session.',
        'Reply AGENT if you need immediate support.',
      ].join('\n');
    default:
      return buildBookingContextSummaryReply(resolvedLanguage, bookingContext);
  }
}

function buildBookingSupportReply({
  resolvedLanguage = 'en',
  bookingContext = null,
  userText = '',
  queryId = null,
} = {}) {
  if (queryId) {
    return buildDeterministicBookingReply({ queryId, resolvedLanguage, bookingContext });
  }
  const intent = resolveBookingSupportIntent(userText);
  if (!intent) {
    return buildBookingContextSummaryReply(resolvedLanguage, bookingContext);
  }
  if (intent.kind === 'booking_reschedule_cancel') {
    return rescheduleCancelReply(resolvedLanguage, bookingContext);
  }
  if (intent.kind === 'booking_create_check') {
    return bookingCreateCheckReply(resolvedLanguage, bookingContext);
  }
  if (intent.kind === 'booking_deterministic') {
    return buildDeterministicBookingReply({
      queryId: intent.queryId,
      resolvedLanguage,
      bookingContext,
    });
  }
  return buildBookingContextSummaryReply(resolvedLanguage, bookingContext);
}

/**
 * Early exit router — runs after Foundation, before Scope / Intent / LLM.
 */
function tryBookingSupportRouter({
  text,
  originalText = null,
  leadContext = null,
  resolvedLanguage = 'en',
} = {}) {
  const intent = resolveBookingSupportIntent(text, originalText);
  if (!intent) return null;

  if (intent.kind === 'human_handoff') {
    return {
      handled: false,
      route: 'human_handoff',
      intent: 'human_handoff',
      reason: 'booking_support_handoff',
    };
  }

  const bookingContext = getBookingContext(leadContext);
  let replyText;
  let routeIntent = 'counselling_support';

  if (intent.kind === 'booking_reschedule_cancel') {
    replyText = rescheduleCancelReply(resolvedLanguage, bookingContext);
    routeIntent = 'booking_reschedule_cancel';
  } else if (intent.kind === 'booking_create_check') {
    replyText = bookingCreateCheckReply(resolvedLanguage, bookingContext);
    routeIntent = 'booking_create_check';
  } else if (intent.kind === 'booking_deterministic') {
    replyText = buildDeterministicBookingReply({
      queryId: intent.queryId,
      resolvedLanguage,
      bookingContext,
    });
    routeIntent = 'counselling_support';
  } else {
    return null;
  }

  return {
    handled: true,
    replyText,
    intent: routeIntent,
    nextState: 'counselling_support',
    deterministic: true,
    queryId: intent.queryId || null,
    bookingContextLoaded: Boolean(bookingContext),
    mongoQueries: bookingContext?._meta?.mongoQueries ?? null,
    resolveMs: bookingContext?._meta?.resolveMs ?? null,
    reason: `booking_support_${intent.kind}`,
  };
}

module.exports = {
  tryBookingSupportRouter,
  buildBookingSupportReply,
  buildDeterministicBookingReply,
  buildBookingContextSummaryReply,
  bookingCreateCheckReply,
  existingBookingCreateReply,
  noBookingReply,
  rescheduleCancelReply,
  getBookingContext,
  isBookingSupportHandoffRequest,
};
