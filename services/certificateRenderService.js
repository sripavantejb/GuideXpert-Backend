const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { formatCertificateExpiryDate } = require('../utils/certificateFormatUtils');

const LOCAL_SVG_PATH = path.join(__dirname, '../assets/certificate.svg');
const WASM_PATH = path.join(__dirname, '../assets/resvg.wasm');
const CERTIFICATE_SVG_URL =
  (process.env.CERTIFICATE_SVG_URL || 'https://www.guidexpert.co.in/certificate.svg').trim();

const CERT_WIDTH = 842;
const CERT_HEIGHT = 596;
const OUTPUT_SCALE = 2;
const OUTPUT_WIDTH = CERT_WIDTH * OUTPUT_SCALE;

const NAME_CONFIG = {
  x: CERT_WIDTH / 2,
  y: 300,
  fontSize: 48,
  fillStyle: '#1f2937',
};

const ISSUED_DATE_CONFIG = {
  x: 196,
  y: 464,
  fontSize: 13,
  fillStyle: '#1a1a1a',
};

const EXPIRY_DATE_CONFIG = {
  x: 196,
  y: 488,
  fontSize: 13,
  fillStyle: '#1a1a1a',
};

const CERTIFICATE_ID_CONFIG = {
  x: 652,
  y: 505,
  fontSize: 11,
  fillStyle: '#1a1a1a',
};

let cachedSvgTemplate = null;
let svgTemplatePromise = null;
let resvgInitPromise = null;
let ResvgClass = null;

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

function readWasmBytes() {
  if (fs.existsSync(WASM_PATH)) {
    return fs.readFileSync(WASM_PATH);
  }
  return fs.readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm'));
}

async function ensureResvgReady() {
  if (ResvgClass) return;
  if (!resvgInitPromise) {
    resvgInitPromise = (async () => {
      const { initWasm, Resvg } = require('@resvg/resvg-wasm');
      await initWasm(readWasmBytes());
      ResvgClass = Resvg;
    })().catch((err) => {
      resvgInitPromise = null;
      throw err;
    });
  }
  await resvgInitPromise;
}

async function loadSvgTemplate() {
  if (cachedSvgTemplate) return cachedSvgTemplate;
  if (!svgTemplatePromise) {
    svgTemplatePromise = (async () => {
      if (fs.existsSync(LOCAL_SVG_PATH)) {
        return fs.readFileSync(LOCAL_SVG_PATH, 'utf8');
      }
      const { data } = await axios.get(CERTIFICATE_SVG_URL, {
        responseType: 'text',
        timeout: 60000,
        maxContentLength: 50 * 1024 * 1024,
        validateStatus: (s) => s === 200,
      });
      const markup = typeof data === 'string' ? data : String(data || '');
      if (!markup.includes('<svg')) {
        throw new Error(`Invalid certificate template from ${CERTIFICATE_SVG_URL}`);
      }
      return markup;
    })().catch((err) => {
      svgTemplatePromise = null;
      throw err;
    });
  }
  cachedSvgTemplate = await svgTemplatePromise;
  return cachedSvgTemplate;
}

async function buildCertificateSvg(name, issuedDateStr, certificateId, expiryDateStr) {
  const template = await loadSvgTemplate();
  const fragment = buildTextOverlayFragment(name, issuedDateStr, certificateId, expiryDateStr);
  const closingIdx = template.lastIndexOf('</svg>');
  if (closingIdx === -1) {
    throw new Error('Invalid certificate SVG template.');
  }
  return `${template.slice(0, closingIdx)}${fragment}${template.slice(closingIdx)}`;
}

/**
 * Warm up renderer (WASM + template). Call from bulk download before ZIP build.
 */
async function warmupCertificateRenderer() {
  await ensureResvgReady();
  await loadSvgTemplate();
  await buildCertificateSvg(' ', formatCertificateDate(), '');
}

/**
 * @param {{ fullName: string, dateIssued: string, certificateId?: string }} params
 * @returns {Promise<Buffer>}
 */
async function renderCertificatePngBuffer(params) {
  const { fullName, dateIssued, certificateId } = params;
  await ensureResvgReady();
  const svgMarkup = await buildCertificateSvg(fullName, dateIssued, certificateId);
  const resvg = new ResvgClass(svgMarkup, {
    fitTo: { mode: 'width', value: OUTPUT_WIDTH },
  });
  const png = resvg.render().asPng();
  return Buffer.from(png);
}

/**
 * @param {{ fullName: string, dateIssued: string, certificateId?: string }} params
 * @returns {Promise<Buffer>}
 */
async function renderCertificatePdfBuffer(params) {
  const pngBuffer = await renderCertificatePngBuffer(params);
  const pngBase64 = pngBuffer.toString('base64');
  const dataUrl = `data:image/png;base64,${pngBase64}`;

  const { jsPDF } = require('jspdf');
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'px',
    format: [CERT_WIDTH, CERT_HEIGHT],
    compress: true,
  });
  pdf.addImage(dataUrl, 'PNG', 0, 0, CERT_WIDTH, CERT_HEIGHT);
  return Buffer.from(pdf.output('arraybuffer'));
}

module.exports = {
  CERT_WIDTH,
  CERT_HEIGHT,
  warmupCertificateRenderer,
  renderCertificatePngBuffer,
  renderCertificatePdfBuffer,
};
