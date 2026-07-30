'use strict';

const {
  buildOfficialBookingUrl,
  getRegistryEntry,
} = require('../../careerCounselling/careerCounsellingV2BookingOrchestratorCore');
const { getPhase13Message } = require('../../../../constants/careerCounsellingV2BookingOrchestrator');
const { resolveBookingServiceKey } = require('../../../../constants/flowV3/flowV3BookingConfig');
const defaultProfileStore = require('../profile');

/** bookingStatus may only progress null → link_sent → done (Phase 13 / B7 guard). */
const BOOKING_STATUS_ORDER = Object.freeze(['link_sent', 'done']);

function normalizeBookingStatus(status) {
  if (status == null || status === '') return null;
  return String(status);
}

function canTransitionBookingStatus(current, next) {
  const cur = normalizeBookingStatus(current);
  if (next === 'link_sent') return cur == null;
  if (next === 'done') return cur === 'link_sent';
  return false;
}

/**
 * M-1 official booking link — registry URL only; never creates WhatsApp/CRM booking.
 * @param {{
 *   phone?: string,
 *   expectedVersion?: number,
 *   serviceKey?: string,
 *   profile?: object,
 *   phase12Service?: string,
 *   phase13Service?: string,
 * }} args
 * @param {{ deps?: { casUpdateLeadProfile?: Function } }} [_ctx]
 */
async function run(args = {}, _ctx = {}) {
  const casUpdate =
    (_ctx.deps && _ctx.deps.casUpdateLeadProfile) || defaultProfileStore.casUpdateLeadProfile;

  const phone = String(args.phone || '').trim();
  if (!phone) return { ok: false, error: 'missing_phone' };
  if (args.expectedVersion == null || Number.isNaN(Number(args.expectedVersion))) {
    return { ok: false, error: 'missing_expected_version' };
  }

  const profile = args.profile || {};

  // D-6: CODE decides which commercial service a booking link points at.
  // Anything the model proposes is ignored outright, never used as a fallback.
  const modelProposedServiceKey = args.serviceKey || null;
  const deterministicServiceKey =
    profile.phase13Service || profile.phase12Service || null;
  const configured = resolveBookingServiceKey(profile, { env: _ctx.env });
  const serviceKey =
    deterministicServiceKey && deterministicServiceKey !== 'none'
      ? deterministicServiceKey
      : configured.serviceKey;
  const serviceKeySource = deterministicServiceKey
    ? 'profile_phase_selection'
    : configured.source;

  if (!serviceKey || serviceKey === 'none') {
    return {
      ok: true,
      needs: ['serviceKey'],
      modelProposedIgnored: Boolean(modelProposedServiceKey),
      // TODO(decision D-6): set FLOW_V3_DEFAULT_BOOKING_SERVICE once the business
      // picks the V3 default service. slotId alone is never sufficient.
    };
  }

  const entry = getRegistryEntry(serviceKey);
  if (!entry) {
    return {
      ok: false,
      error: 'unmapped_service',
      serviceKey,
      // TODO(decision D-6): confirm fallback when registry lacks serviceKey from context.
    };
  }

  const url = buildOfficialBookingUrl(entry);
  if (!url) {
    return { ok: false, error: 'missing_url', serviceKey };
  }

  const currentStatus = normalizeBookingStatus(profile.bookingStatus);
  if (currentStatus === 'done') {
    return { ok: false, error: 'booking_already_complete', bookingStatus: 'done' };
  }

  if (currentStatus === 'link_sent') {
    const shareCopy = getPhase13Message('url_share')
      .replace(/\{ctaLabel\}/g, entry.ctaLabel)
      .replace(/\{url\}/g, url);
    return {
      ok: true,
      idempotent: true,
      serviceKey,
      url,
      bookingStatus: 'link_sent',
      shareCopy,
    };
  }

  if (!canTransitionBookingStatus(currentStatus, 'link_sent')) {
    return {
      ok: false,
      error: 'invalid_booking_status_transition',
      from: currentStatus,
      to: 'link_sent',
      allowed: BOOKING_STATUS_ORDER,
    };
  }

  const now = new Date();
  const outcome = await casUpdate({
    phone,
    expectedVersion: Number(args.expectedVersion),
    profilePatch: {
      bookingStatus: 'link_sent',
      bookingUrlShared: true,
      bookingLinkSentAt: now,
      phase13Service: serviceKey,
    },
    enforceLlmAllowlist: false,
    turnId: args.turnId || _ctx.turnId || null,
  });

  if (!outcome.ok) {
    return { ok: false, reason: outcome.reason, doc: outcome.doc || null };
  }

  const shareCopy = getPhase13Message('url_share')
    .replace(/\{ctaLabel\}/g, entry.ctaLabel)
    .replace(/\{url\}/g, url);

  return {
    ok: true,
    serviceKey,
    serviceKeySource,
    modelProposedIgnored: Boolean(modelProposedServiceKey),
    url,
    bookingStatus: 'link_sent',
    shareCopy,
    doc: outcome.doc,
    casVersion: outcome.doc ? outcome.doc.casVersion : null,
  };
}

module.exports = {
  run,
  canTransitionBookingStatus,
  BOOKING_STATUS_ORDER,
};
