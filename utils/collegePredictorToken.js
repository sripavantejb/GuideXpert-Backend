/**
 * Single bearer token for all college predictor callers (counsellor API, public API,
 * WhatsApp chatbot). Uses the same Vercel/local env as the counsellor tool — no
 * WhatsApp-specific variable.
 *
 * Primary: NW_PREDICTORS_ACCESS_TOKEN (already on Vercel)
 * Fallback: COLLEGEDOST_ACCESS_TOKEN (legacy installs only)
 */
function getCollegePredictorAccessToken() {
  const token =
    process.env.NW_PREDICTORS_ACCESS_TOKEN || process.env.COLLEGEDOST_ACCESS_TOKEN;
  if (!token || !String(token).trim()) return null;
  return String(token).trim();
}

module.exports = {
  getCollegePredictorAccessToken,
};
