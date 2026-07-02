/** Max stored SVG markup length (chars ≈ bytes for typical poster SVG). */
const MAX_POSTER_SVG_CHARS = 3 * 1024 * 1024;

function formatPosterSvgLimitLabel() {
  return '3 MB';
}

module.exports = {
  MAX_POSTER_SVG_CHARS,
  formatPosterSvgLimitLabel,
};
