const jwt = require('jsonwebtoken');
const Bda = require('../models/Bda');
const { getBdaJwtSecret } = require('../middleware/requireBda');

const JWT_EXPIRES_IN = process.env.BDA_JWT_EXPIRES_IN || '7d';

function mapBdaUser(bda) {
  return {
    id: String(bda._id),
    bdaId: String(bda._id),
    name: bda.name,
    email: bda.email || '',
    phone: bda.phone || '',
    role: bda.role || 'BDA',
    status: bda.status,
  };
}

function normalizeLoginId(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { type: null, value: '' };
  if (s.includes('@')) return { type: 'email', value: s.toLowerCase() };
  const digits = s.replace(/\D/g, '').slice(-10);
  if (/^\d{10}$/.test(digits)) return { type: 'phone', value: digits };
  return { type: 'email', value: s.toLowerCase() };
}

exports.login = async (req, res) => {
  try {
    const { email, phone, login, password } = req.body || {};
    const loginRaw = login || email || phone;
    const { type, value } = normalizeLoginId(loginRaw);
    if (!type || !value) {
      return res.status(400).json({ success: false, message: 'Email or phone is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password is required' });
    }

    const secret = getBdaJwtSecret();
    if (!secret) {
      return res.status(500).json({ success: false, message: 'BDA login is not configured' });
    }

    const query = type === 'email' ? { email: value } : { phone: value };
    const bda = await Bda.findOne(query).select('+password');
    if (!bda) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    if (bda.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Account is inactive. Contact admin.' });
    }
    const ok = await bda.comparePassword(password);
    if (!ok) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign({ bdaId: String(bda._id), role: 'BDA' }, secret, {
      expiresIn: JWT_EXPIRES_IN,
    });

    return res.status(200).json({
      success: true,
      data: {
        token,
        user: mapBdaUser(bda),
      },
    });
  } catch (error) {
    console.error('[bdaLogin]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.me = async (req, res) => {
  return res.status(200).json({ success: true, data: mapBdaUser(req.bda) });
};

exports.logout = async (_req, res) => {
  return res.status(200).json({ success: true, message: 'Logged out' });
};
