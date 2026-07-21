'use strict';

const {
  BOOKING_SERVICE_REGISTRY,
  GUARANTEE_FORBIDDEN,
  getPhase13Message,
} = require('../../../constants/careerCounsellingV2BookingOrchestrator');

function assertPhase13Guardrails(text, { allowUrl = false } = {}) {
  const t = String(text || '');
  for (const re of GUARANTEE_FORBIDDEN) {
    if (re.test(t)) throw new Error(`Phase 13 guardrail: ${re}`);
  }
  if (!allowUrl) {
    if (/https?:\/\//i.test(t) || /guidexpert\.co\.in/i.test(t)) {
      throw new Error('Phase 13 guardrail: URL forbidden before Book Now');
    }
  }
  return t;
}

function getBookableServiceKey(profile = {}) {
  const key = profile.phase13Service || profile.phase12Service || null;
  if (!key || key === 'none') return null;
  if (!BOOKING_SERVICE_REGISTRY[key]) return null;
  return key;
}

function shouldSkipPhase13(profile = {}) {
  if (profile.phase11Escalated === true) {
    return { skip: true, reason: 'phase11_escalated' };
  }
  if (profile.phase11ExitTarget === 'one_on_one_escalation') {
    return { skip: true, reason: 'phase11_ooo_exit' };
  }
  if (profile.niatOneOnOneRecommended === true) {
    return { skip: true, reason: 'niat_one_on_one_shown' };
  }
  const service = profile.phase12Service || profile.phase13Service;
  if (service === 'none') {
    return { skip: true, reason: 'service_none' };
  }
  if (!service) {
    return { skip: true, reason: 'no_service' };
  }
  if (!BOOKING_SERVICE_REGISTRY[service]) {
    return { skip: true, reason: 'unmapped_service' };
  }
  return { skip: false, reason: null };
}

function getRegistryEntry(serviceKey) {
  return BOOKING_SERVICE_REGISTRY[serviceKey] || null;
}

/**
 * Build official booking URL exclusively from registry entry.
 * Single-form destination is the official One-on-One landing page (no query clutter).
 */
function buildOfficialBookingUrl(entry) {
  if (!entry || !entry.baseUrl) return null;
  return String(entry.baseUrl).replace(/\?.*$/, '');
}

function resolveBookingDestination(profile = {}) {
  const skip = shouldSkipPhase13(profile);
  if (skip.skip) {
    return { ok: false, skip: true, reason: skip.reason, entry: null, url: null, service: null };
  }

  const service = getBookableServiceKey(profile) || profile.phase12Service;
  const entry = getRegistryEntry(service);
  if (!entry) {
    return {
      ok: false,
      skip: false,
      abandoned: true,
      reason: 'unmapped_service',
      entry: null,
      url: null,
      service,
    };
  }

  const url = buildOfficialBookingUrl(entry);
  if (!url) {
    return {
      ok: false,
      skip: false,
      abandoned: true,
      reason: 'missing_url',
      entry,
      url: null,
      service,
    };
  }

  return { ok: true, skip: false, reason: null, entry, url, service };
}

function buildIntroReply(entry) {
  const reply = getPhase13Message('intro').replace(/\{ctaLabel\}/g, entry.ctaLabel);
  assertPhase13Guardrails(reply, { allowUrl: false });
  return reply;
}

function buildUrlShareReply(entry, url) {
  const reply = getPhase13Message('url_share')
    .replace(/\{ctaLabel\}/g, entry.ctaLabel)
    .replace(/\{url\}/g, url);
  assertPhase13Guardrails(reply, { allowUrl: true });
  if (!reply.includes(url)) {
    throw new Error('Phase 13 guardrail: registry URL missing from share reply');
  }
  return reply;
}

module.exports = {
  assertPhase13Guardrails,
  getBookableServiceKey,
  shouldSkipPhase13,
  getRegistryEntry,
  buildOfficialBookingUrl,
  resolveBookingDestination,
  buildIntroReply,
  buildUrlShareReply,
  BOOKING_SERVICE_REGISTRY,
};
