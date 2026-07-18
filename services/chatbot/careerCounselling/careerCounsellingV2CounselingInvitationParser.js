'use strict';

const { normalizeText } = require('../intentTextUtils');

function isInvitationAccept(text) {
  const t = normalizeText(text);
  return /^(yes|yeah|yep|yup|sure|ok|okay|please|y|book|accept|i('?| a)?m ready|go ahead)\b/i.test(
    t
  );
}

function isInvitationDefer(text) {
  const t = normalizeText(text);
  return /^(later|maybe later|not now|remind me later|afterwards|sometime|defer)\b/i.test(t);
}

function isInvitationDecline(text) {
  const t = normalizeText(text);
  return /^(no|nope|nah|n|not interested|decline|skip|don'?t want)\b/i.test(t);
}

function isInvitationQuestion(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 4) return false;
  if (isInvitationAccept(t) || isInvitationDefer(t) || isInvitationDecline(t)) return false;
  return /\?\s*$|\b(what|how|why|when|where|which|tell me|explain|can you|could you)\b/i.test(t);
}

module.exports = {
  isInvitationAccept,
  isInvitationDefer,
  isInvitationDecline,
  isInvitationQuestion,
};
