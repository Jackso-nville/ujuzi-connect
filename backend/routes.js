// The API: the addresses the browser calls to do things.
// Stage 3 contains: sign up, log in, categories, fundi profiles and prices, browsing fundis.
const router = require('express').Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, ServiceCategory, FundiProfile, Review } = require('./models');
const { recommend } = require('./ai');

// ---------- Small helpers used by every route ----------
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);           // sends errors to the error handler
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : ''); // accepts only text, trimmed and limited
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);           // is this a valid database id?
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// Checks the login token and the user's role. The server enforces roles; hiding a button is never enough.
const auth = (...roles) => (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET); }
  catch { return bad(res, 'Please log in to continue.', 401); }
  if (roles.length && !roles.includes(req.user.role)) return bad(res, 'Your account cannot do this.', 403);
  next();
};

const session = (u) => ({
  token: jwt.sign({ id: String(u._id), role: u.role, name: u.name }, process.env.JWT_SECRET, { expiresIn: '12h' }),
  user: { id: String(u._id), name: u.name, role: u.role },
});

// ---------- Sign up and log in ----------
router.post('/auth/register', wrap(async (req, res) => {
  const name = str(req.body.name, 80);
  const email = str(req.body.email, 120).toLowerCase();
  const password = str(req.body.password, 100);
  const role = req.body.role === 'fundi' ? 'fundi' : 'client';
  if (!name) return bad(res, 'Enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 'Enter a valid email address.');
  if (password.length < 8) return bad(res, 'Use a password with at least 8 characters.');
  try {
    const user = await User.create({ name, email, role, passwordHash: await bcrypt.hash(password, 12) });
    if (role === 'fundi') await FundiProfile.create({ userId: user._id });   // every fundi starts with an empty profile
    res.status(201).json(session(user));
  } catch (e) {
    if (e.code === 11000) return bad(res, 'An account with this email already exists.', 409);
    throw e;
  }
}));

router.post('/auth/login', wrap(async (req, res) => {
  const user = await User.findOne({ email: str(req.body.email, 120).toLowerCase() });
  const ok = user && (await bcrypt.compare(str(req.body.password, 100), user.passwordHash));
  if (!ok) return bad(res, 'Email or password is incorrect.', 401);
  res.json(session(user));
}));

router.get('/categories', wrap(async (req, res) => {
  const cats = await ServiceCategory.find({ active: true }).sort('name').lean();
  res.json(cats.map((c) => ({ id: c._id, name: c.name })));
}));

// ---------- The fundi's own profile ----------
router.get('/profile', auth('fundi'), wrap(async (req, res) => {
  const profile = (await FundiProfile.findOne({ userId: req.user.id }).lean()) || {};
  const user = await User.findById(req.user.id, 'phone').lean();
  res.json({ ...profile, phone: (user && user.phone) || '' });
}));

router.put('/profile', auth('fundi'), wrap(async (req, res) => {
  const b = req.body;
  const skills = (Array.isArray(b.skills) ? b.skills : []).map((s) => str(s, 40)).filter(Boolean).slice(0, 15);
  const wanted = (Array.isArray(b.serviceCategories) ? b.serviceCategories : []).filter(isId);
  const valid = await ServiceCategory.find({ _id: { $in: wanted }, active: true }, '_id').lean();   // only real categories
  const years = Number(b.experienceYears);
  const amount = Number(b.rateAmount);
  if (b.rateAmount !== '' && b.rateAmount != null && !(Number.isFinite(amount) && amount >= 0 && amount <= 1000000)) {
    return bad(res, 'Enter your price as a number between 0 and 1,000,000.');
  }
  const unit = ['per job', 'per hour', 'per day'].includes(b.rateUnit) ? b.rateUnit : 'per job';

  await FundiProfile.findOneAndUpdate({ userId: req.user.id }, {
    skills,
    serviceCategories: valid.map((c) => c._id),
    location: str(b.location, 80),
    experienceYears: b.experienceYears !== '' && Number.isFinite(years) ? Math.min(60, Math.max(0, years)) : undefined,
    availability: ['available', 'busy', 'unspecified'].includes(b.availability) ? b.availability : 'unspecified',
    description: str(b.description, 600),
    rate: { amount: b.rateAmount === '' || b.rateAmount == null ? undefined : amount, unit },
  }, { upsert: true, runValidators: true });
  await User.updateOne({ _id: req.user.id }, { phone: str(b.phone, 20) });   // the phone number stays private
  res.json({ ok: true });
}));

// ---------- Browsing fundis (public) ----------
router.get('/fundis', wrap(async (req, res) => {
  const categoryId = isId(req.query.category) ? req.query.category : null;
  res.json(await recommend({ categoryId, location: str(req.query.location, 80) }));
}));

// One fundi's public profile page. Phone and email are never included here.
router.get('/fundis/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'Fundi not found.', 404);
  const p = await FundiProfile.findOne({ userId: req.params.id }).populate('userId', 'name createdAt').populate('serviceCategories', 'name').lean();
  if (!p || !p.userId) return bad(res, 'Fundi not found.', 404);
  const reviews = await Review.find({ fundiId: req.params.id }).sort('-createdAt').limit(20).populate('clientId', 'name').lean();
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;
  res.json({
    fundiId: p.userId._id, name: p.userId.name, memberSince: p.userId.createdAt, location: p.location || '',
    skills: p.skills || [], services: (p.serviceCategories || []).map((c) => c.name), experienceYears: p.experienceYears,
    availability: p.availability, description: p.description || '', rate: p.rate || null,
    rating: avg ? Number(avg.toFixed(1)) : null, reviewCount: reviews.length,
    reviews: reviews.map((r) => ({ rating: r.rating, comment: r.comment, client: r.clientId ? r.clientId.name : 'Client', date: r.createdAt })),
  });
}));

module.exports = router;