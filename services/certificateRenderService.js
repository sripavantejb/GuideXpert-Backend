const fs = require('fs');
const path = require('path');
const { formatCertificateExpiryDate } = require('../utils/certificateFormatUtils');

const CERTIFICATE_SVG_PATH = path.join(__dirname, '../assets/certificate.svg');

const CERT_WIDTH = 842;
const CERT_HEIGHT = 596;
const OUTPUT_SCALE = 2;
const OUTPUT_WIDTH = CERT_WIDTH * OUTPUT_SCALE;
const OUTPUT_HEIGHT = CERT_HEIGHT * OUTPUT_SCALE;

const NAME_CONFIG = {
  x: CERT_WIDTH / 2,
  y: 300,
  fontSize: 48,
  fontFamily: 'cursive, Georgia, serif',
  fillStyle: '#1f2937',
};

const ISSUED_DATE_CONFIG = {
  x: 196,
  y: 464,
  fontSize: 13,
  fontFamily: 'Georgia, "Times New Roman", serif',
  fillStyle: '#1a1a1a',
};

const EXPIRY_DATE_CONFIG = {
  x: 196,
  y: 488,
  fontSize: 13,
  fontFamily: 'Georgia, "Times New Roman", serif',
  fillStyle: '#1a1a1a',
};

const CERTIFICATE_ID_CONFIG = {
  x: 652,
  y: 505,
  fontSize: 11,
  fontFamily: 'Georgia, "Times New Roman", serif',
  fillStyle: '#1a1a1a',
};

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

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildTextOverlayFragment(name, issuedDateStr, certificateId, expiryDateStr) {
  const issued = issuedDateStr || formatCertificateDate();
  const expiry = expiryDateStr || formatCertificateExpiryDate(issued);
  const displayName = escapeXml(String(name || ' ').trim() || ' ');
  const certId = certificateId && String(certificateId).trim()
    ? `<text x="${CERTIFICATE_ID_CONFIG.x}" y="${CERTIFICATE_ID_CONFIG.y}" font-size="${CERTIFICATE_ID_CONFIG.fontSize}" fill="${CERTIFICATE_ID_CONFIG.fillStyle}" font-family="Georgia, serif">${escapeXml(String(certificateId).trim())}</text>`
    : '';

  return `<g id="certificate-dynamic-fields">
  <text x="${NAME_CONFIG.x}" y="${NAME_CONFIG.y}" text-anchor="middle" dominant-baseline="middle" font-size="${NAME_CONFIG.fontSize}" fill="${NAME_CONFIG.fillStyle}" font-family="cursive, Georgia, serif">${displayName}</text>
  <text x="${ISSUED_DATE_CONFIG.x}" y="${ISSUED_DATE_CONFIG.y}" font-size="${ISSUED_DATE_CONFIG.fontSize}" fill="${ISSUED_DATE_CONFIG.fillStyle}" font-family="Georgia, serif">${escapeXml(issued)}</text>
  <text x="${EXPIRY_DATE_CONFIG.x}" y="${EXPIRY_DATE_CONFIG.y}" font-size="${EXPIRY_DATE_CONFIG.fontSize}" fill="${EXPIRY_DATE_CONFIG.fillStyle}" font-family="Georgia, serif">${escapeXml(expiry)}</text>
  ${certId}
</g>`;
}

let cachedSvgTemplate = null;

function loadCertificateSvgWithFields(name, issuedDateStr, certificateId, expiryDateStr) {
  if (!cachedSvgTemplate) {
    cachedSvgTemplate = fs.readFileSync(CERTIFICATE_SVG_PATH, 'utf8');
  }
  const fragment = buildTextOverlayFragment(name, issuedDateStr, certificateId, expiryDateStr);
  const closingIdx = cachedSvgTemplate.lastIndexOf('</svg>');
  if (closingIdx === -1) {
    throw new Error('Invalid certificate SVG template.');
  }
  return `${cachedSvgTemplate.slice(0, closingIdx)}${fragment}${cachedSvgTemplate.slice(closingIdx)}`;
}

function getSharp() {
  return require('sharp');
}

function getJsPDF() {
  const { jsPDF } = require('jspdf');
  return jsPDF;
}

/**
 * @param {{ fullName: string, dateIssued: string, certificateId?: string }} params
 * @returns {Promise<Buffer>}
 */
async function renderCertificatePngBuffer(params) {
  const { fullName, dateIssued, certificateId } = params;
  const sharp = getSharp();

  if (!fs.existsSync(CERTIFICATE_SVG_PATH)) {
    throw new Error('Certificate template asset missing.');
  }

  const svgMarkup = loadCertificateSvgWithFields(fullName, dateIssued, certificateId);
  const png = await sharp(Buffer.from(svgMarkup), { density: OUTPUT_SCALE * 72 })
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: 'fill' })
    .png()
    .toBuffer();

  return png;
}

/**
 * @param {{ fullName: string, dateIssued: string, certificateId?: string }} params
 * @returns {Promise<Buffer>}
 */
async function renderCertificatePdfBuffer(params) {
  const pngBuffer = await renderCertificatePngBuffer(params);
  const pngBase64 = pngBuffer.toString('base64');
  const dataUrl = `data:image/png;base64,${pngBase64}`;

  const jsPDF = getJsPDF();
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'px',
    format: [CERT_WIDTH, CERT_HEIGHT],
    compress: true,
  });
  pdf.addImage(dataUrl, 'PNG', 0, 0, CERT_WIDTH, CERT_HEIGHT);
  const arrayBuffer = pdf.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}

module.exports = {
  CERT_WIDTH,
  CERT_HEIGHT,
  renderCertificatePngBuffer,
  renderCertificatePdfBuffer,
};
