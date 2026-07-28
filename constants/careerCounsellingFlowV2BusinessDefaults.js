'use strict';

/**
 * Flow V3 — conservative business defaults applied while Part 19 open items
 * remain unanswered. Implements GUIDEXPERT_MASTER_FLOW.md (v3).
 *
 * DEFAULTED PENDING BUSINESS CONFIRMATION — every consumer site must keep a
 * local comment with this exact phrase + the open-item id below so a future
 * developer can find them without chat history:
 *
 *   rg "DEFAULTED PENDING BUSINESS CONFIRMATION"
 *
 * Open items (GUIDEXPERT_MASTER_FLOW.md Part 3 / Part 19):
 *   ◆ FREE / Assumption 1 — is the 1-on-1 free?
 *   ◆ NIAT-1 — CSE only, or CSE with AI/data specialisations?
 *   ◆ NIAT-2 — does NIAT project work touch robotics/automation? (NO → no claim)
 *   ◆ CAT-1 — which catalog colleges carry CORE branches?
 *   ◆ CAT-2 — can B8 mix rank-gated + new-age colleges? (locked NO here)
 *   ◆ CAT-3 — unknown external college detail depth (checklist fallback)
 *   ◆ CORE-1 / Variant B — pure-core human coverage? (locked Variant B exit)
 *   ◆ SCOPE / Assumption 2 — medical / law / MBA in chatbot scope? (NO → R11)
 *   ◆ BOOKING-HYBRID — Phase 1: live slots in chat, website create only
 *     (Section E / Phase 13 freeze — no WhatsApp CRM booking writes)
 */

module.exports = Object.freeze({
  FREE_SESSION: Object.freeze({
    openItem: 'Assumption 1 / Part 19 · free session',
    defaultApplied: true,
    meaning: 'Chat + 1-on-1 claimed free in B1 / R5 / I-7 until business confirms otherwise.',
  }),
  NIAT_CSE_ONLY: Object.freeze({
    openItem: '◆ NIAT-1',
    defaultApplied: true,
    meaning: 'NIAT framed as CSE/AI careers only; no broader branch claims.',
  }),
  NIAT_NO_ROBOTICS_CLAIM: Object.freeze({
    openItem: '◆ NIAT-2',
    defaultApplied: true,
    meaning: 'No robotics/automation curriculum claim in shortlist/fork copy.',
  }),
  NO_MIXED_CATALOGS: Object.freeze({
    openItem: '◆ CAT-2',
    defaultApplied: true,
    meaning: 'Predictor rank list and curated shortlist never merge into one list.',
  }),
  CORE_BRANCH_CATALOG_UNKNOWN: Object.freeze({
    openItem: '◆ CAT-1',
    defaultApplied: true,
    meaning: 'No verified CORE-branch college catalog; pure-core interest uses Variant B exit instead of inventing CORE shortlists.',
  }),
  UNKNOWN_COLLEGE_CHECKLIST: Object.freeze({
    openItem: '◆ CAT-3',
    defaultApplied: true,
    meaning: 'Unknown colleges get an evaluation checklist, not invented facts.',
  }),
  VARIANT_B_PURE_CORE_EXIT: Object.freeze({
    openItem: '◆ CORE-1 / Variant B',
    defaultApplied: true,
    meaning: 'Pure-core F2 is a warm terminal parked_core exit; no B4–B10 re-entry.',
  }),
  ENGINEERING_TECH_SCOPE_ONLY: Object.freeze({
    openItem: 'Assumption 2 / medical·law·MBA scope',
    defaultApplied: true,
    meaning: 'Medical/law/MBA/out-of-catalog commerce-arts → honest scope / R11.',
  }),
  /** DEFAULTED PENDING BUSINESS CONFIRMATION — ◆ BOOKING-HYBRID / Phase 1 */
  HYBRID_BOOKING_WEBSITE_CREATE: Object.freeze({
    openItem: '◆ BOOKING-HYBRID / Phase 1 (Section E freeze)',
    defaultApplied: true,
    meaning:
      'Node 0 / book path shows live GuidanceSlot options in chat, then hands off to the official website URL. WhatsApp never creates OneOnOneCounselingLead or increments slot bookings.',
  }),
  SENIOR_COUNSELLOR_CREDENTIAL: Object.freeze({
    openItem: '◆ CRED / B10-a — Option 3 company happy-path override',
    defaultApplied: true,
    meaning:
      'Happy-path B10 copy uses "IITian" per company Stage 10 script (overrides prior senior-counsellor lock). Follow-up chase remains not the company 30m/1h/3h cadence.',
  }),
  EDITORIAL_SHORTLIST_DISCLOSURE: Object.freeze({
    openItem: '◆ PAID / B8-b',
    defaultApplied: true,
    meaning: 'Shortlist placement treated as editorial; disclosure line still mandatory at B8.',
  }),
});
