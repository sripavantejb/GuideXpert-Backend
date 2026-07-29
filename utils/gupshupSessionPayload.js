/**
 * Gupshup wa/api/v1/msg session message payload builders.
 *
 * Gupshup expects its own session shapes (`type: list`, `type: quick_reply`),
 * not Meta Cloud API `type: interactive` envelopes. Sending the Cloud format
 * causes WhatsApp to show the raw JSON as plain text.
 */

/**
 * Strip the leading/trailing blank space WhatsApp renders as an empty line
 * above (or below) the bubble content, and collapse runs of blank lines.
 * Spacing that is part of the copy — single blank lines between paragraphs —
 * is preserved.
 */
function normalizeMessageText(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/^[\s\u200b\u200c\u200d\u00a0\ufeff]+/, '')
    .replace(/[\s\u200b\u200c\u200d\u00a0\ufeff]+$/, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * WhatsApp list cards always allocate a header row. An omitted / blank / ZWSP
 * title leaves that row empty — the "top gap". When the caller asks for no
 * heading and the body has more than one line, move the first line into
 * `title` so the header row shows real content; remaining lines stay in body.
 */
function resolveListTitleAndBody(rawTitle, rawBody) {
  const body = normalizeMessageText(rawBody);
  const title = normalizeMessageText(rawTitle);
  if (title) return { title: title.slice(0, 60), body };

  const nl = body.indexOf('\n');
  if (nl === -1) return { title: '', body };

  const firstLine = body.slice(0, nl).trim();
  const rest = normalizeMessageText(body.slice(nl + 1));
  if (firstLine && firstLine.length <= 60 && rest) {
    return { title: firstLine, body: rest };
  }
  return { title: '', body };
}

function buildTextMessageField(text, previewUrl = false) {
  return JSON.stringify({
    type: 'text',
    text: normalizeMessageText(text).slice(0, 4096),
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
      text: normalizeMessageText(p.body).slice(0, 1024),
    },
    options,
  });
}

/**
 * Fallback heading used only if Gupshup rejects a list without a title.
 * Prefer resolveListTitleAndBody (first-line promotion) over this — a
 * zero-width space still renders as an empty header line.
 */
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
 * Pass `title: ''` (or whitespace) to avoid a separate heading. For multi-line
 * bodies the first line is used as the WhatsApp header so the reserved header
 * row is not left blank.
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
  // Callers pass title: '' when they want no separate heading.
  const { title, body } = explicitTitle && !String(p.title).trim()
    ? resolveListTitleAndBody('', p.body)
    : resolveListTitleAndBody(rawTitle, p.body);

  return JSON.stringify({
    type: 'list',
    ...(title ? { title } : {}),
    body: body.slice(0, 1024),
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

/**
 * Image message with optional caption.
 * @param {{ url: string, caption?: string }} p
 */
function buildImageMessageField(p) {
  const url = String(p.url || '').trim();
  const caption = normalizeMessageText(p.caption).slice(0, 1024);
  const field = {
    type: 'image',
    originalUrl: url,
    previewUrl: url,
  };
  if (caption) field.caption = caption;
  return JSON.stringify(field);
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
  buildImageMessageField,
  listMessageNeedsEncode,
  normalizeMessageText,
  resolveListTitleAndBody,
  HIDDEN_LIST_TITLE,
};
