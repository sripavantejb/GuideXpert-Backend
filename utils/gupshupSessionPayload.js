/**
 * Gupshup wa/api/v1/msg session message payload builders.
 *
 * Gupshup expects its own session shapes (`type: list`, `type: quick_reply`),
 * not Meta Cloud API `type: interactive` envelopes. Sending the Cloud format
 * causes WhatsApp to show the raw JSON as plain text.
 */

function buildTextMessageField(text, previewUrl = false) {
  return JSON.stringify({
    type: 'text',
    text: String(text || '').slice(0, 4096),
    previewUrl: Boolean(previewUrl),
  });
}

/**
 * Quick-reply style button message (up to 3 buttons).
 * @param {{ body: string, buttons: Array<{ id: string, title: string }>, msgid?: string }} p
 */
function buildInteractiveButtonMessageField(p) {
  const options = (p.buttons || []).slice(0, 3).map((b) => ({
    type: 'text',
    title: String(b.title || '').slice(0, 20),
    postbackText: String(b.id || b.title || '').slice(0, 256),
  }));
  return JSON.stringify({
    type: 'quick_reply',
    msgid: String(p.msgid || 'qr1').slice(0, 64),
    content: {
      type: 'text',
      text: String(p.body || '').slice(0, 1024),
    },
    options,
  });
}

/** Zero-width space — Gupshup requires a title; this hides the card heading. */
const HIDDEN_LIST_TITLE = '\u200b';

/**
 * List message (single section, up to 10 rows).
 * @param {{
 *   body: string,
 *   buttonText: string,
 *   sections: Array<{ title: string, rows: Array<{ id: string, title: string, description?: string }> }>,
 *   title?: string,
 *   msgid?: string,
 * }} p
 *
 * Pass `title: ''` (or whitespace) to suppress the WhatsApp card header so the
 * body question asks directly — otherwise defaults to the first section title.
 */
function buildInteractiveListMessageField(p) {
  const firstSection = (p.sections || [])[0] || { title: '', rows: [] };
  const options = (firstSection.rows || []).slice(0, 10).map((r) => {
    const option = {
      type: 'text',
      title: String(r.title || '').slice(0, 24),
      postbackText: String(r.id || r.title || '').slice(0, 200),
    };
    if (r.description) {
      option.description = String(r.description).slice(0, 72);
    }
    return option;
  });

  const explicitTitle = p.title !== undefined && p.title !== null;
  const rawTitle = explicitTitle
    ? String(p.title)
    : String(firstSection.title || 'Select');
  const title = (rawTitle.trim() ? rawTitle : HIDDEN_LIST_TITLE).slice(0, 60);

  return JSON.stringify({
    type: 'list',
    title,
    body: String(p.body || '').slice(0, 1024),
    msgid: String(p.msgid || 'list1').slice(0, 64),
    globalButtons: [
      {
        type: 'text',
        title: String(p.buttonText || 'Options').slice(0, 20),
      },
    ],
    items: [
      {
        title: String(firstSection.title || 'Options').slice(0, 24),
        options,
      },
    ],
  });
}

/** True when list body/titles need Gupshup `encode=true` (emoji / non-ASCII). */
function listMessageNeedsEncode(body, sections) {
  const chunks = [String(body || '')];
  for (const sec of sections || []) {
    chunks.push(String(sec?.title || ''));
    for (const row of sec?.rows || []) {
      chunks.push(String(row?.title || ''), String(row?.description || ''));
    }
  }
  return /[^\x00-\x7F]/.test(chunks.join(''));
}

module.exports = {
  buildTextMessageField,
  buildInteractiveButtonMessageField,
  buildInteractiveListMessageField,
  listMessageNeedsEncode,
};
