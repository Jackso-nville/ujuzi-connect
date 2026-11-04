// The API: the addresses the browser calls to do things.
// Stage 2 contains: sign up, log in and the list of service categories.
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, ServiceCategory } = require('./models');

// ---------- Small helpers used by every route ----------
// Passes any error to the server's error handler instead of crashing
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
// Accepts only text, trims it and limits its length (this also blocks sneaky objects sent by attackers)
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// Sends an error message to the browser
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// Creates the login token that the browser keeps after logging in
const session = (u) => ({
  token: jwt.sign({ id: String(u._id), role: u.role, name: u.name }, process.env.JWT_SECRET, { expiresIn: '12h' }),
  user: { id: String(u._id), name: u.name, role: u.role },
});

// ---------- Sign up ----------
router.post('/auth/register', wrap(async (req, res) => {
  const name = str(req.body.name, 80);
  const email = str(req.body.email, 120).toLowerCase();
  const password = str(req.body.password, 100);
  const role = req.body.role === 'fundi' ? 'fundi' : 'client';   // only client or fundi can sign up

  if (!name) return bad(res, 'Enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 'Enter a valid email address.');
  if (password.length < 8) return bad(res, 'Use a password with at least 8 characters.');

  try {
    // The password is scrambled (hashed) so nobody can read it, not even you
    const user = await User.create({ name, email, role, passwordHash: await bcrypt.hash(password, 12) });
    res.status(201).json(session(user));
  } catch (e) {
    if (e.code === 11000) return bad(res, 'An account with this email already exists.', 409);
    throw e;
  }
}));

// ---------- Log in ----------
router.post('/auth/login', wrap(async (req, res) => {
  const user = await User.findOne({ email: str(req.body.email, 120).toLowerCase() });
  const ok = user && (await bcrypt.compare(str(req.body.password, 100), user.passwordHash));
  // The same message for a wrong email or a wrong password, so nobody can guess which emails exist
  if (!ok) return bad(res, 'Email or password is incorrect.', 401);
  res.json(session(user));
}));

// ---------- Service categories (for the dropdown) ----------
router.get('/categories', wrap(async (req, res) => {
  const cats = await ServiceCategory.find({ active: true }).sort('name').lean();
  res.json(cats.map((c) => ({ id: c._id, name: c.name })));
}));

module.exports = router;