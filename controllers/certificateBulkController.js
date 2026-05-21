const WebinarCertificate = require('../models/WebinarCertificate');
const otpRepository = require('../utils/otpRepository');
const {
  formatCertificateExpiryDate,
  buildCertificateFileBaseName,
} = require('../utils/certificateFormatUtils');

const BULK_DOWNLOAD_MAX_PHONES = 200;

async function loadBulkDeps() {
  try {
    const archiver = require('archiver');
    const renderService = require('../services/certificateRenderService');
    await renderService.warmupCertificateRenderer();
    return {
      archiver,
      renderCertificatePngBuffer: renderService.renderCertificatePngBuffer,
      renderCertificatePdfBuffer: renderService.renderCertificatePdfBuffer,
    };
  } catch (err) {
    console.error('[bulkDownloadCertificates] Failed to load render dependencies:', err?.stack || err?.message || err);
    return { error: err?.message || 'Certificate renderer unavailable' };
  }
}

function parseMobileNumbersFromBody(body) {
  const rawList = [];
  if (Array.isArray(body?.mobileNumbers)) {
    rawList.push(...body.mobileNumbers);
  }
  if (typeof body?.mobileNumbersText === 'string' && body.mobileNumbersText.trim()) {
    rawList.push(
      ...body.mobileNumbersText.split(/[\n,;\s]+/).map((s) => s.trim()).filter(Boolean)
    );
  }
  return rawList;
}

function normalizePhoneList(rawList) {
  const seen = new Set();
  const phones = [];
  const invalid = [];

  for (const raw of rawList) {
    const mobile = otpRepository.normalize(String(raw || '').trim());
    if (!mobile || mobile.length !== 10) {
      if (String(raw || '').trim()) invalid.push(String(raw).trim());
      continue;
    }
    if (seen.has(mobile)) continue;
    seen.add(mobile);
    phones.push(mobile);
  }

  return { phones, invalid };
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildManifestCsv(rows) {
  const header =
    'mobileNumber,certificateId,fullName,dateIssued,expiryDate,createdAt,status,fileBaseName';
  const lines = rows.map((r) =>
    [
      r.mobileNumber,
      r.certificateId,
      r.fullName,
      r.dateIssued,
      r.expiryDate,
      r.createdAt,
      r.status,
      r.fileBaseName,
    ]
      .map(csvEscape)
      .join(',')
  );
  return `${header}\n${lines.join('\n')}\n`;
}

/**
 * POST /api/admin/certificates/bulk-download
 * Body: { mobileNumbers?: string[], mobileNumbersText?: string }
 */
exports.bulkDownloadCertificates = async (req, res) => {
  try {
    const deps = await loadBulkDeps();
    if (!deps || deps.error) {
      return res.status(503).json({
        success: false,
        message: deps?.error || 'Certificate rendering is unavailable on this server. Contact support.',
      });
    }

    const { archiver, renderCertificatePngBuffer, renderCertificatePdfBuffer } = deps;

    const rawList = parseMobileNumbersFromBody(req.body || {});
    if (rawList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Provide mobileNumbers array or mobileNumbersText.',
      });
    }

    const { phones, invalid } = normalizePhoneList(rawList);

    if (phones.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid 10-digit mobile numbers found.',
        invalid,
      });
    }

    if (phones.length > BULK_DOWNLOAD_MAX_PHONES) {
      return res.status(413).json({
        success: false,
        message: `Bulk download limited to ${BULK_DOWNLOAD_MAX_PHONES} numbers per request.`,
      });
    }

    const docs = await WebinarCertificate.find({ mobileNumber: { $in: phones } }).lean();
    const byPhone = new Map(docs.map((d) => [d.mobileNumber, d]));

    const manifestRows = [];
    const archive = archiver('zip', { zlib: { level: 6 } });

    const dateStamp = new Date().toISOString().slice(0, 10);
    const zipFilename = `certificates-bulk-${dateStamp}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
    res.setHeader('Cache-Control', 'no-store');

    archive.on('error', (err) => {
      console.error('[bulkDownloadCertificates] archiver error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Failed to build ZIP archive.' });
      } else {
        res.end();
      }
    });

    archive.pipe(res);

    for (const phone of phones) {
      const doc = byPhone.get(phone);
      if (!doc) {
        manifestRows.push({
          mobileNumber: phone,
          certificateId: '',
          fullName: '',
          dateIssued: '',
          expiryDate: '',
          createdAt: '',
          status: 'not_found',
          fileBaseName: '',
        });
        continue;
      }

      const certificateId = doc.certificateId != null ? String(doc.certificateId).trim() : '';
      const fullName = doc.fullName != null ? String(doc.fullName).trim() : '';
      const dateIssued = doc.dateIssued != null ? String(doc.dateIssued).trim() : '';
      const expiryDate = formatCertificateExpiryDate(dateIssued);
      const createdAt = doc.createdAt ? new Date(doc.createdAt).toISOString() : '';
      const fileBaseName = buildCertificateFileBaseName(fullName, dateIssued, certificateId);

      manifestRows.push({
        mobileNumber: phone,
        certificateId,
        fullName,
        dateIssued,
        expiryDate,
        createdAt,
        status: 'found',
        fileBaseName,
      });

      const renderParams = { fullName, dateIssued, certificateId };
      const [pngBuffer, pdfBuffer] = await Promise.all([
        renderCertificatePngBuffer(renderParams),
        renderCertificatePdfBuffer(renderParams),
      ]);

      archive.append(pngBuffer, { name: `certificates/${fileBaseName}.png` });
      archive.append(pdfBuffer, { name: `certificates/${fileBaseName}.pdf` });
    }

    archive.append(Buffer.from(buildManifestCsv(manifestRows), 'utf8'), { name: 'manifest.csv' });

    await archive.finalize();
  } catch (err) {
    console.error('[bulkDownloadCertificates]', err?.message || err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: 'Failed to generate bulk certificates.' });
    }
    res.end();
  }
};
