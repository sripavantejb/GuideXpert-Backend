'use strict';

/**
 * Render a validated envelope into orchestrator-shaped outbound fields.
 */

const { SHORTLIST_DISCLOSURE } = require('../validate/validateEnvelope');

const ASSET_KEYS = Object.freeze({
  two_models_frame:
    'https://res.cloudinary.com/dfqdb1xws/image/upload/v1785308851/WhatsApp_Image_2026-07-29_at_12.35.01_PM_bm2zsf.jpg',
});

/**
 * @param {object} envelope
 * @param {{ toolTrace?: Array, bookingUrl?: string|null }} [opts]
 */
function renderEnvelope(envelope, opts = {}) {
  const replyParts = [];
  let interactive = null;
  let replyMedia = null;
  let bookingUrl = opts.bookingUrl || null;

  if (!bookingUrl && envelope.booking_url_slot != null) {
    for (const t of opts.toolTrace || []) {
      if (t.name === 'create_booking_link' && t.result?.url) {
        bookingUrl = t.result.url;
        break;
      }
    }
  }

  for (const part of envelope.parts || []) {
    if (part.type === 'text') {
      let body = String(part.body || '');
      if (bookingUrl && envelope.booking_url_slot != null && !/https?:\/\//i.test(body)) {
        body = `${body}\n\n👉 ${bookingUrl}`.trim();
      }
      if (body) replyParts.push(body);
    } else if (part.type === 'buttons') {
      interactive = {
        type: 'button',
        body: String(part.body || ''),
        buttons: (part.options || []).slice(0, 3).map((o) => ({
          id: String(o.id || o.title || 'opt'),
          title: String(o.title || 'OK').slice(0, 20),
        })),
      };
    } else if (part.type === 'list') {
      interactive = {
        type: 'list',
        body: String(part.body || ''),
        buttonText: String(part.button || 'Select').slice(0, 20),
        sections: [
          {
            title: 'Options',
            rows: (part.rows || []).slice(0, 10).map((r) => ({
              id: String(r.id || r.title || 'row'),
              title: String(r.title || 'Option').slice(0, 24),
              description: r.description ? String(r.description).slice(0, 72) : undefined,
            })),
          },
        ],
      };
    } else if (part.type === 'image') {
      const url = ASSET_KEYS[part.assetKey] || null;
      if (url) {
        replyMedia = { type: 'image', url, caption: part.caption || '' };
      }
    }
  }

  if (envelope.intent === 'show_shortlist') {
    const hasDisclosure = replyParts.some((p) => /editorial|not a guaranteed admission/i.test(p));
    if (!hasDisclosure) replyParts.push(SHORTLIST_DISCLOSURE);
  }

  return {
    replyText: replyParts.length === 1 && !interactive ? replyParts[0] : null,
    replyParts: replyParts.length ? replyParts : null,
    interactive,
    replyMedia,
    bookingUrl,
  };
}

module.exports = {
  ASSET_KEYS,
  renderEnvelope,
};
