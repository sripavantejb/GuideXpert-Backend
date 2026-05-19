/**
 * Gupshup wa/api/v1/template/msg payload builders (unit-testable).
 * Image-header templates use a separate `message` form field per Gupshup docs.
 */

/**
 * @param {{ id: string, params?: string[] }} p
 * @returns {string}
 */
function buildTemplateField(p) {
  return JSON.stringify({ id: p.id, params: p.params || [] });
}

/**
 * @param {{ link: string }} p
 * @returns {string}
 */
function buildImageMessageField(p) {
  return JSON.stringify({
    type: 'image',
    image: { link: p.link }
  });
}

module.exports = {
  buildTemplateField,
  buildImageMessageField
};
