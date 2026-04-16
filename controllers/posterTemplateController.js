const PosterTemplate = require('../models/PosterTemplate');
const TrainingFeedback = require('../models/TrainingFeedback');

const MAX_SVG_CHARS = 2 * 1024 * 1024; // ~2MB text

/** Public poster URLs must live under /p/... (React Router + SPA). */
function isPosterPublicPath(routeNorm) {
  return typeof routeNorm === 'string' && routeNorm.startsWith('/p/') && routeNorm.length > 3;
}

function normalizeMobile10(raw) {
  if (raw == null) return '';
  const d = String(raw).replace(/\D/g, '').slice(-10);
  return d.length === 10 ? d : '';
}

/** Trim, strip query/hash, ensure leading slash, lowercase for stable matching. */
function normalizeRoute(route) {
  if (route == null) return '';
  let s = String(route).trim();
  if (!s) return '';
  s = s.split('?')[0].split('#')[0];
  if (!s.startsWith('/')) s = `/${s}`;
  return s.toLowerCase();
}

function isLikelySvg(s) {
  if (typeof s !== 'string' || !s.length) return false;
  return /<svg[\s>/]/i.test(s.trim());
}

function sanitizeOverlayField(raw) {
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  return {
    x: Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 12,
    y: Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : 12,
    fontSize: Number.isFinite(Number(raw?.fontSize)) ? Math.min(400, Math.max(4, Number(raw.fontSize))) : 20,
    color: raw?.color != null ? String(raw.color).slice(0, 32) : '#111827',
    fontWeight: raw?.fontWeight != null ? String(raw.fontWeight).slice(0, 32) : '600',
    textAlign: ['left', 'center', 'right', 'justify'].includes(raw?.textAlign) ? raw.textAlign : 'left',
  };
}

function defaultNameField() {
  return sanitizeOverlayField({ x: 12, y: 12, fontSize: 22, fontWeight: '600' });
}

function defaultMobileField() {
  return sanitizeOverlayField({ x: 12, y: 24, fontSize: 18, fontWeight: '500' });
}

/** Map old `elements[]` documents to nameField / mobileField */
function migrateLegacyElements(elements) {
  if (!Array.isArray(elements) || elements.length === 0) {
    return { nameField: defaultNameField(), mobileField: defaultMobileField() };
  }
  const byId = (id) => elements.find((e) => e && String(e.id) === id);
  const nameSrc = byId('name') || elements[0];
  const mobileSrc =
    byId('mobile') || byId('phone') || (elements.length > 1 ? elements[1] : null);
  return {
    nameField: sanitizeOverlayField(nameSrc || defaultNameField()),
    mobileField: sanitizeOverlayField(mobileSrc || defaultMobileField()),
  };
}

function resolveFieldsFromDoc(o) {
  const hasNew =
    o.nameField &&
    o.mobileField &&
    typeof o.nameField === 'object' &&
    typeof o.mobileField === 'object';
  if (hasNew) {
    return {
      nameField: sanitizeOverlayField(o.nameField),
      mobileField: sanitizeOverlayField(o.mobileField),
    };
  }
  if (Array.isArray(o.elements) && o.elements.length > 0) {
    return migrateLegacyElements(o.elements);
  }
  return { nameField: defaultNameField(), mobileField: defaultMobileField() };
}

function toDto(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  const { nameField, mobileField } = resolveFieldsFromDoc(o);
  return {
    id: String(o._id),
    name: o.name,
    route: o.route,
    svgTemplate: o.svgTemplate,
    nameField,
    mobileField,
    published: !!o.published,
    publishedAt: o.publishedAt || null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

/** Public API: poster config without leaking admin-only fields (same fields; published always true when returned). */
function toPublicDto(doc) {
  const base = toDto(doc);
  if (!base) return null;
  delete base.published;
  delete base.publishedAt;
  return base;
}

exports.normalizeRoute = normalizeRoute;

exports.listPosters = async (req, res) => {
  try {
    const rows = await PosterTemplate.find({}).sort({ updatedAt: -1 }).lean();
    return res.json({ success: true, posters: rows.map((r) => toDto(r)) });
  } catch (err) {
    console.error('[listPosters]', err);
    return res.status(500).json({ success: false, message: 'Failed to list posters.' });
  }
};

exports.getPoster = async (req, res) => {
  try {
    const doc = await PosterTemplate.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Poster not found.' });
    return res.json({ success: true, poster: toDto(doc) });
  } catch (err) {
    console.error('[getPoster]', err);
    return res.status(500).json({ success: false, message: 'Failed to load poster.' });
  }
};

exports.createPoster = async (req, res) => {
  try {
    const body = req.body || {};
    const name = body.name != null ? String(body.name).trim() : '';
    const svgTemplate = body.svgTemplate != null ? String(body.svgTemplate) : '';
    const routeNorm = normalizeRoute(body.route);

    if (!name || name.length > 200) {
      return res.status(400).json({ success: false, message: 'name is required (max 200 chars).' });
    }
    if (!routeNorm) {
      return res.status(400).json({ success: false, message: 'route is required.' });
    }
    if (!isPosterPublicPath(routeNorm)) {
      return res.status(400).json({
        success: false,
        message: 'route must start with /p/ (e.g. /p/my-campaign) so the public app can serve this poster.',
      });
    }
    if (!svgTemplate.length || svgTemplate.length > MAX_SVG_CHARS) {
      return res.status(400).json({
        success: false,
        message: `svgTemplate must be non-empty SVG and under ${MAX_SVG_CHARS} characters.`,
      });
    }
    if (!isLikelySvg(svgTemplate)) {
      return res.status(400).json({ success: false, message: 'svgTemplate must look like SVG markup.' });
    }

    const nameField = body.nameField != null ? sanitizeOverlayField(body.nameField) : defaultNameField();
    const mobileField = body.mobileField != null ? sanitizeOverlayField(body.mobileField) : defaultMobileField();

    const exists = await PosterTemplate.findOne({ route: routeNorm }).lean();
    if (exists) {
      return res.status(409).json({ success: false, message: 'A poster for this route already exists.' });
    }

    const doc = await PosterTemplate.create({
      name,
      route: routeNorm,
      svgTemplate,
      nameField,
      mobileField,
      published: false,
      publishedAt: null,
    });
    return res.status(201).json({ success: true, poster: toDto(doc) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: 'A poster for this route already exists.' });
    }
    console.error('[createPoster]', err);
    return res.status(500).json({ success: false, message: 'Failed to create poster.' });
  }
};

exports.updatePoster = async (req, res) => {
  try {
    const doc = await PosterTemplate.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Poster not found.' });

    const body = req.body || {};
    if (body.name != null) {
      const name = String(body.name).trim();
      if (!name || name.length > 200) {
        return res.status(400).json({ success: false, message: 'Invalid name.' });
      }
      doc.name = name;
    }
    if (body.route != null) {
      const routeNorm = normalizeRoute(body.route);
      if (!routeNorm) {
        return res.status(400).json({ success: false, message: 'Invalid route.' });
      }
      if (!isPosterPublicPath(routeNorm)) {
        return res.status(400).json({
          success: false,
          message: 'route must start with /p/ (e.g. /p/my-campaign).',
        });
      }
      if (routeNorm !== doc.route) {
        const clash = await PosterTemplate.findOne({ route: routeNorm, _id: { $ne: doc._id } }).lean();
        if (clash) {
          return res.status(409).json({ success: false, message: 'A poster for this route already exists.' });
        }
        doc.route = routeNorm;
      }
    }
    if (body.svgTemplate != null) {
      const svgTemplate = String(body.svgTemplate);
      if (!svgTemplate.length || svgTemplate.length > MAX_SVG_CHARS) {
        return res.status(400).json({ success: false, message: 'Invalid svgTemplate.' });
      }
      if (!isLikelySvg(svgTemplate)) {
        return res.status(400).json({ success: false, message: 'svgTemplate must look like SVG markup.' });
      }
      doc.svgTemplate = svgTemplate;
    }
    if (body.nameField != null) {
      doc.nameField = sanitizeOverlayField(body.nameField);
    }
    if (body.mobileField != null) {
      doc.mobileField = sanitizeOverlayField(body.mobileField);
    }
    doc.markModified('nameField');
    doc.markModified('mobileField');

    await doc.save();
    return res.json({ success: true, poster: toDto(doc) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: 'A poster for this route already exists.' });
    }
    console.error('[updatePoster]', err);
    return res.status(500).json({ success: false, message: 'Failed to update poster.' });
  }
};

exports.deletePoster = async (req, res) => {
  try {
    const result = await PosterTemplate.deleteOne({ _id: req.params.id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Poster not found.' });
    }
    return res.json({ success: true, message: 'Deleted.' });
  } catch (err) {
    console.error('[deletePoster]', err);
    return res.status(500).json({ success: false, message: 'Failed to delete poster.' });
  }
};

exports.getPosterByRoute = async (req, res) => {
  try {
    const routeNorm = normalizeRoute(req.query.route);
    if (!routeNorm) {
      return res.status(400).json({ success: false, message: 'Missing or invalid route query parameter.' });
    }
    const doc = await PosterTemplate.findOne({ route: routeNorm, published: true }).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'No published poster for this route.' });
    }
    return res.json({ success: true, poster: toPublicDto(doc) });
  } catch (err) {
    console.error('[getPosterByRoute]', err);
    return res.status(500).json({ success: false, message: 'Failed to load poster.' });
  }
};

exports.publishPoster = async (req, res) => {
  try {
    const doc = await PosterTemplate.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Poster not found.' });
    const routeNorm = normalizeRoute(doc.route);
    if (!isPosterPublicPath(routeNorm)) {
      return res.status(400).json({
        success: false,
        message: 'Save a route starting with /p/ before publishing.',
      });
    }
    if (!doc.svgTemplate || !isLikelySvg(String(doc.svgTemplate))) {
      return res.status(400).json({ success: false, message: 'Upload a valid SVG before publishing.' });
    }
    doc.published = true;
    doc.publishedAt = new Date();
    await doc.save();
    return res.json({ success: true, poster: toDto(doc) });
  } catch (err) {
    console.error('[publishPoster]', err);
    return res.status(500).json({ success: false, message: 'Failed to publish poster.' });
  }
};

exports.unpublishPoster = async (req, res) => {
  try {
    const doc = await PosterTemplate.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Poster not found.' });
    doc.published = false;
    doc.publishedAt = null;
    await doc.save();
    return res.json({ success: true, poster: toDto(doc) });
  } catch (err) {
    console.error('[unpublishPoster]', err);
    return res.status(500).json({ success: false, message: 'Failed to unpublish poster.' });
  }
};

/**
 * POST /api/posters/verify-activation — public; mobile must match TrainingFeedback for this published route.
 */
exports.verifyPosterActivation = async (req, res) => {
  try {
    const routeNorm = normalizeRoute(req.body?.route ?? req.query?.route);
    const mobile = normalizeMobile10(req.body?.mobile ?? req.body?.phone ?? req.body?.mobileNumber);
    if (!routeNorm) {
      return res.status(400).json({ success: false, message: 'route is required.' });
    }
    if (!mobile) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required.' });
    }
    const poster = await PosterTemplate.findOne({ route: routeNorm, published: true }).lean();
    if (!poster) {
      return res.status(404).json({ success: false, message: 'No published poster for this page.' });
    }
    const fb = await TrainingFeedback.findOne({ mobileNumber: mobile }).lean().select('name mobileNumber');
    if (!fb) {
      return res.status(200).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'No activation record found for this number.',
      });
    }
    return res.json({
      success: true,
      name: fb.name || '',
      mobile: fb.mobileNumber || mobile,
    });
  } catch (err) {
    console.error('[verifyPosterActivation]', err);
    return res.status(500).json({ success: false, message: 'Verification failed.' });
  }
};
