const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { jsPDF } = require('jspdf');

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
  fontFamily: 'cursive',
  fillStyle: '#1f2937',
  textAlign: 'center',
  textBaseline: 'middle',
};

const ISSUED_DATE_CONFIG = {
  x: 196,
  y: 464,
  fontSize: 13,
  fontFamily: 'Georgia, "Times New Roman", serif',
  fillStyle: '#1a1a1a',
  textAlign: 'left',
  textBaseline: 'alphabetic',
};

const EXPIRY_DATE_CONFIG = {
  x: 196,
  y: 488,
  fontSize: 13,
  fontFamily: 'Georgia, "Times New Roman", serif',
  fillStyle: '#1a1a1a',
  textAlign: 'left',
  textBaseline: 'alphabetic',
};

const CERTIFICATE_ID_CONFIG = {
  x: 652,
  y: 505,
  fontSize: 11,
  fontFamily: 'Georgia, "Times New Roman", serif',
  fillStyle: '#1a1a1a',
  textAlign: 'left',
  textBaseline: 'alphabetic',
};

let cachedBackgroundImage = null;

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

function drawTextField(ctx, config, text, scale) {
  const value = String(text || '').trim();
  if (!value) return;
  ctx.fillStyle = config.fillStyle;
  ctx.font = `${config.fontSize * scale}px ${config.fontFamily}`;
  ctx.textAlign = config.textAlign;
  ctx.textBaseline = config.textBaseline;
  ctx.fillText(value, config.x * scale, config.y * scale);
}

async function loadCertificateBackground() {
  if (cachedBackgroundImage) return cachedBackgroundImage;
  cachedBackgroundImage = await loadImage(CERTIFICATE_SVG_PATH);
  return cachedBackgroundImage;
}

async function drawCertificateToCanvas(img, name, issuedDateStr, certificateId, expiryDateStr) {
  const canvas = createCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT);
  const ctx = canvas.getContext('2d');
  const scale = OUTPUT_SCALE;
  const issued = issuedDateStr || formatCertificateDate();
  const expiry = expiryDateStr || formatCertificateExpiryDate(issued);

  ctx.drawImage(img, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
  ctx.save();

  ctx.fillStyle = NAME_CONFIG.fillStyle;
  ctx.font = `${NAME_CONFIG.fontSize * scale}px ${NAME_CONFIG.fontFamily}`;
  ctx.textAlign = NAME_CONFIG.textAlign;
  ctx.textBaseline = NAME_CONFIG.textBaseline;
  ctx.fillText(String(name || ' ').trim() || ' ', NAME_CONFIG.x * scale, NAME_CONFIG.y * scale);

  drawTextField(ctx, ISSUED_DATE_CONFIG, issued, scale);
  drawTextField(ctx, EXPIRY_DATE_CONFIG, expiry, scale);

  if (certificateId && String(certificateId).trim()) {
    drawTextField(ctx, CERTIFICATE_ID_CONFIG, String(certificateId).trim(), scale);
  }

  ctx.restore();
  return canvas;
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

/**
 * @param {{ fullName: string, dateIssued: string, certificateId?: string }} params
 * @returns {Promise<Buffer>}
 */
async function renderCertificatePngBuffer(params) {
  const { fullName, dateIssued, certificateId } = params;
  const img = await loadCertificateBackground();
  const canvas = await drawCertificateToCanvas(img, fullName, dateIssued, certificateId);
  return canvas.toBuffer('image/png');
}

/**
 * @param {{ fullName: string, dateIssued: string, certificateId?: string }} params
 * @returns {Promise<Buffer>}
 */
async function renderCertificatePdfBuffer(params) {
  const pngBuffer = await renderCertificatePngBuffer(params);
  const pngBase64 = pngBuffer.toString('base64');
  const dataUrl = `data:image/png;base64,${pngBase64}`;

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
  formatCertificateExpiryDate,
  buildCertificateFileBaseName,
  renderCertificatePngBuffer,
  renderCertificatePdfBuffer,
};
