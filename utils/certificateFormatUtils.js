function formatCertificateDate(d = new Date()) {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) {
    return formatCertificateDate(new Date());
  }
  const day = date.getDate();
  const month = date.toLocaleString('en-IN', { month: 'long' });
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

function formatCertificateExpiryDate(issuedDateStr) {
  const raw = String(issuedDateStr || '').trim();
  const parsed = raw ? Date.parse(raw) : NaN;
  const base = Number.isFinite(parsed) ? new Date(parsed) : new Date();
  const expiry = new Date(base);
  expiry.setFullYear(expiry.getFullYear() + 1);
  return formatCertificateDate(expiry);
}

function buildCertificateFileBaseName(fullName, dateIssued, certificateId) {
  const safeName = (fullName || 'Certificate')
    .replace(/[^a-zA-Z0-9-\s]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40);
  const datePart = (dateIssued || '').replace(/\s+/g, '-');
  const idPrefix = certificateId ? `${String(certificateId).trim()}-` : '';
  return `${idPrefix}GuideXpert-Career-Counsellor-Certificate-${safeName}-${datePart}`;
}

module.exports = {
  formatCertificateExpiryDate,
  buildCertificateFileBaseName,
};
