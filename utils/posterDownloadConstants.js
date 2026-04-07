/**
 * Single source of truth for poster download analytics (track + Mongoose enum).
 * Keep in sync with frontend trackPosterDownloadBeacon posterKey values.
 */
const POSTER_KEYS = ['holi', 'inter', 'gx', 'sid', 'jee', 'certified'];
const FORMATS = ['png', 'pdf'];

module.exports = { POSTER_KEYS, FORMATS };
