/**
 * Gupshup wa/api/v1/msg session message payload builders.
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
 * @param {{ body: string, buttons: Array<{ id: string, title: string }> }} p
 */
function buildInteractiveButtonMessageField(p) {
  const buttons = (p.buttons || []).slice(0, 3).map((b) => ({
    type: 'reply',
    reply: {
      id: String(b.id).slice(0, 256),
      title: String(b.title).slice(0, 20),
    },
  }));
  return JSON.stringify({
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: String(p.body || '').slice(0, 1024) },
      action: { buttons },
    },
  });
}

/**
 * List message (single section, up to 10 rows).
 * @param {{ body: string, buttonText: string, sections: Array<{ title: string, rows: Array<{ id: string, title: string, description?: string }> }> }} p
 */
function buildInteractiveListMessageField(p) {
  const sections = (p.sections || []).slice(0, 1).map((sec) => ({
    title: String(sec.title || '').slice(0, 24),
    rows: (sec.rows || []).slice(0, 10).map((r) => ({
      id: String(r.id).slice(0, 200),
      title: String(r.title).slice(0, 24),
      description: r.description ? String(r.description).slice(0, 72) : undefined,
    })),
  }));
  return JSON.stringify({
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: String(p.body || '').slice(0, 1024) },
      action: {
        button: String(p.buttonText || 'Options').slice(0, 20),
        sections,
      },
    },
  });
}

module.exports = {
  buildTextMessageField,
  buildInteractiveButtonMessageField,
  buildInteractiveListMessageField,
};
