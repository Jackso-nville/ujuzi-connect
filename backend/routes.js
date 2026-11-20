// The API: the addresses the browser calls to do things.
// Stage 14 contains: sign up, log in, categories, fundi profiles and prices, browsing fundis,
// the job board (post jobs, send offers, accept one), the AI suggestion, ranked search, recommendations and invitations on each job, reviews and the administrator tools.
// Stage 17 adds: profile photos and /stats (in extras.js), and a help assistant that checks live jobs (in live.js).
const router = require('express').Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendResetEmail } = require('./mailer');
const { answer: assistantAnswer } = require('./assistant');
const { User, ServiceCategory, FundiProfile, JobRequest, Offer, Review, PortfolioItem, Message } = require('./models');
const { recommend, interpret } = require('./ai');

// ---------- Small helpers used by every route ----------
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);           // sends errors to the error handler
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : ''); // accepts only text, trimmed and limited
const isId = (v) => typeof v === 'string' && mongoose.isValidObjectId(v);           // is this a valid database id?
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const phoneOk = (p) => /^[0-9+\-\s()]{7,20}$/.test(p);                               // a plausible phone number

// Enforces strong passwords for new and existing accounts
const passwordOk = (password) =>
  password.length >= 8 &&
  /[A-Z]/.test(password) &&
  /[a-z]/.test(password) &&
  /[0-9]/.test(password) &&
  /[^A-Za-z0-9\s]/.test(password);
// Checks the login token and the user's role. The server enforces roles; hiding a button is never enough.
const auth = (...roles) => (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET); }
  catch { return bad(res, 'Please log in to continue.', 401); }
  if (roles.length && !roles.includes(req.user.role)) return bad(res, 'Your account cannot do this.', 403);
  next();
};

const session = (u) => ({
  token: jwt.sign({ id: String(u._id), role: u.role, name: u.name }, process.env.JWT_SECRET, { expiresIn: '12h' }),
  user: { id: String(u._id), name: u.name, role: u.role, hasPhoto: !!u.hasPhoto },
});

// ---------- Sign up and log in ----------
router.post('/auth/register', wrap(async (req, res) => {
  const name = str(req.body.name, 80);
  const email = str(req.body.email, 120).toLowerCase();
  const password = str(req.body.password, 100);
  const role = req.body.role === 'fundi' ? 'fundi' : 'client';
  if (!name) return bad(res, 'Enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 'Enter a valid email address.');
if (!passwordOk(password)) {
  return bad(res, 'Password must have at least 8 characters, an uppercase letter, a lowercase letter, a number and a special character.');
}
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

// ---------- Forgot password ----------
// Always gives the same answer, so nobody can use this form to find out which emails have accounts
router.post('/auth/forgot', wrap(async (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const user = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? await User.findOne({ email }) : null;
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');                       // the secret in the emailed link
    user.resetTokenHash = crypto.createHash('sha256').update(token).digest('hex'); // only a scrambled copy is stored
    user.resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000);             // valid for 30 minutes
    await user.save();
    try { await sendResetEmail(user.email, `${process.env.APP_URL || 'http://localhost:3000'}/?reset=${token}`); }
    catch (e) { console.error('Could not send the reset email:', e.message); }
  }
  res.json({ message: 'If an account exists for that email, a reset link has been sent. The link works for 30 minutes.' });
}));


 // ---------- Choose a new password with the link ----------
router.post('/auth/reset', wrap(async (req, res) => {
  const token = str(req.body.token, 100);
  const password = str(req.body.password, 100);

  if (!token) return bad(res, 'This reset link is invalid or has expired. Please request a new one.');

  if (!passwordOk(password)) {
    return bad(res, 'Password must have at least 8 characters, an uppercase letter, a lowercase letter, a number and a special character.');
  }

  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({ resetTokenHash: hash, resetTokenExpires: { $gt: new Date() } });

  if (!user) return bad(res, 'This reset link is invalid or has expired. Please request a new one.');

  user.passwordHash = await bcrypt.hash(password, 12);
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  await user.save();

  res.json({ ok: true });
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
  if (str(b.phone, 20) && !phoneOk(str(b.phone, 20))) return bad(res, 'Enter a valid phone number, or leave it empty.');

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
  res.json(await recommend({ categoryId, location: str(req.query.location, 80), skill: str(req.query.skill, 40) }));
}));

// One fundi's public profile page. Phone and email are never included here.
router.get('/fundis/:id', wrap(async (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'Fundi not found.', 404);
  const p = await FundiProfile.findOne({ userId: req.params.id }).populate('userId', 'name createdAt hasPhoto').populate('serviceCategories', 'name').lean();
  if (!p || !p.userId) return bad(res, 'Fundi not found.', 404);
  const reviews = await Review.find({ fundiId: req.params.id }).sort('-createdAt').limit(20).populate('clientId', 'name').lean();
  const work = await PortfolioItem.find({ fundiId: req.params.id }, 'caption priceAmount').sort('-createdAt').limit(12).lean();   // no photo data here
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;
  res.json({
    fundiId: p.userId._id, hasPhoto: !!p.userId.hasPhoto, name: p.userId.name, memberSince: p.userId.createdAt, location: p.location || '',
    skills: p.skills || [], services: (p.serviceCategories || []).map((c) => c.name), experienceYears: p.experienceYears,
    availability: p.availability, description: p.description || '', rate: p.rate || null,
    rating: avg ? Number(avg.toFixed(1)) : null, reviewCount: reviews.length,
    portfolio: work.map((w) => ({ id: w._id, caption: w.caption || '', price: w.priceAmount })),
    reviews: reviews.map((r) => ({ rating: r.rating, comment: r.comment, client: r.clientId ? r.clientId.name : 'Client', date: r.createdAt })),
  });
}));

// ====================== PHOTOS OF WORK DONE ======================
const MAX_PHOTO_BYTES = 800 * 1024;

// Checks that the upload really is a small JPG, PNG or WebP photo, by looking at its first bytes
function readPhoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '');
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > MAX_PHOTO_BYTES) return null;
  const real = (m[1] === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    || (m[1] === 'image/png' && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    || (m[1] === 'image/webp' && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP');
  return real ? { contentType: m[1], image: buf } : null;
}

// The fundi's own photos
router.get('/portfolio/mine', auth('fundi'), wrap(async (req, res) => {
  const items = await PortfolioItem.find({ fundiId: req.user.id }, 'caption priceAmount').sort('-createdAt').lean();
  res.json(items.map((w) => ({ id: w._id, caption: w.caption || '', price: w.priceAmount })));
}));

// Add a photo (up to 12 per fundi)
router.post('/portfolio', auth('fundi'), wrap(async (req, res) => {
  const photo = readPhoto(req.body.image);
  if (!photo) return bad(res, 'Upload a JPG, PNG or WebP photo under 800 KB.');
  if ((await PortfolioItem.countDocuments({ fundiId: req.user.id })) >= 12) return bad(res, 'You can show up to 12 photos. Delete one to add another.');
  const price = req.body.price === '' || req.body.price == null ? undefined : Number(req.body.price);
  if (price !== undefined && !(Number.isFinite(price) && price >= 0 && price <= 1000000)) return bad(res, 'Enter the price as a number, or leave it empty.');
  await PortfolioItem.create({ fundiId: req.user.id, caption: str(req.body.caption, 120), priceAmount: price, ...photo });
  res.status(201).json({ ok: true });
}));

// Delete one of your own photos
router.delete('/portfolio/:id', auth('fundi'), wrap(async (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'Photo not found.', 404);
  const r = await PortfolioItem.deleteOne({ _id: req.params.id, fundiId: req.user.id });   // only your own photos
  if (!r.deletedCount) return bad(res, 'Photo not found.', 404);
  res.json({ ok: true });
}));

// The photo itself. Public, because anyone can look at a fundi's work.
router.get('/portfolio/:id/image', wrap(async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).end();
  const item = await PortfolioItem.findById(req.params.id, 'image contentType');
  if (!item) return res.status(404).end();
  res.set({ 'Content-Type': item.contentType, 'Cache-Control': 'public, max-age=86400' });
  res.send(item.image);
}));

// ====================== MESSAGES ======================
// A client and a fundi can message each other about a job once the fundi has sent an offer on it.
// Nobody else can start or read a conversation.
async function chatAccess(user, jobId, fundiId) {
  if (!isId(jobId) || !isId(fundiId)) return null;
  const job = await JobRequest.findById(jobId).lean();
  if (!job) return null;
  const isClient = user.role === 'client' && String(job.clientId) === user.id;
  const isFundi = user.role === 'fundi' && fundiId === user.id;
  if (!isClient && !isFundi) return null;                                   // not part of this conversation
  const offer = await Offer.findOne({ jobId: job._id, fundiId }).lean();
  if (!offer) return null;                                                  // no offer, no chat
  return { job, offer, isClient, recipientId: isClient ? fundiId : String(job.clientId),
    canSend: offer.status !== 'declined' && job.status !== 'cancelled' };   // closed chats stay readable
}

// How many unread messages I have (shown as a badge in the menu)
router.get('/messages/unread-count', auth('client', 'fundi'), wrap(async (req, res) => {
  res.json({ count: await Message.countDocuments({ recipientId: req.user.id, readAt: null }) });
}));

// My inbox: one line per conversation, newest first
router.get('/messages/conversations', auth('client', 'fundi'), wrap(async (req, res) => {
  const me = new mongoose.Types.ObjectId(req.user.id);
  const groups = await Message.aggregate([
    { $match: { $or: [{ senderId: me }, { recipientId: me }] } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: { jobId: '$jobId', fundiId: '$fundiId' }, last: { $first: '$$ROOT' },
        unread: { $sum: { $cond: [{ $and: [{ $eq: ['$recipientId', me] }, { $eq: ['$readAt', null] }] }, 1, 0] } } } },
    { $sort: { 'last.createdAt': -1 } },
    { $limit: 50 },
  ]);
  const jobs = await JobRequest.find({ _id: { $in: groups.map((g) => g._id.jobId) } }).populate('serviceCategoryId', 'name').lean();
  const jobBy = Object.fromEntries(jobs.map((j) => [String(j._id), j]));
  const otherId = (g) => (String(g.last.senderId) === req.user.id ? g.last.recipientId : g.last.senderId);
  const people = await User.find({ _id: { $in: groups.map(otherId) } }, 'name').lean();
  const nameBy = Object.fromEntries(people.map((u) => [String(u._id), u.name]));
  res.json(groups.filter((g) => jobBy[String(g._id.jobId)]).map((g) => {
    const j = jobBy[String(g._id.jobId)];
    return {
      jobId: g._id.jobId, fundiId: g._id.fundiId, with: nameBy[String(otherId(g))] || 'Former user',
      category: j.serviceCategoryId && j.serviceCategoryId.name, job: j.description.slice(0, 80),
      last: g.last.text.slice(0, 100), lastMine: String(g.last.senderId) === req.user.id, lastAt: g.last.createdAt, unread: g.unread,
    };
  }));
}));

// One conversation. Opening it marks the messages sent to me as read.
router.get('/messages/thread', auth('client', 'fundi'), wrap(async (req, res) => {
  const a = await chatAccess(req.user, req.query.jobId, req.query.fundiId);
  if (!a) return bad(res, 'Conversation not found.', 404);
  const msgs = await Message.find({ jobId: a.job._id, fundiId: req.query.fundiId }).sort('createdAt').limit(200).lean();
  await Message.updateMany({ jobId: a.job._id, fundiId: req.query.fundiId, recipientId: req.user.id, readAt: null }, { readAt: new Date() });
  const other = await User.findById(a.recipientId, 'name').lean();
  const cat = await ServiceCategory.findById(a.job.serviceCategoryId, 'name').lean();
  res.json({
    with: (other && other.name) || 'Former user', category: cat && cat.name, job: a.job.description.slice(0, 200),
    jobStatus: a.job.status, canSend: a.canSend,
    messages: msgs.map((m) => ({ id: m._id, text: m.text, createdAt: m.createdAt, mine: String(m.senderId) === req.user.id })),
  });
}));

// Send a message
router.post('/messages', auth('client', 'fundi'), wrap(async (req, res) => {
  const a = await chatAccess(req.user, req.body.jobId, req.body.fundiId);
  if (!a) return bad(res, 'Conversation not found.', 404);
  if (!a.canSend) return bad(res, 'This conversation is closed, so you can no longer send messages.');
  const text = str(req.body.text, 1000);
  if (!text) return bad(res, 'Type a message first.');
  await Message.create({ jobId: a.job._id, fundiId: req.body.fundiId, senderId: req.user.id, recipientId: a.recipientId, text });
  res.status(201).json({ ok: true });
}));

// ====================== THE HELP ASSISTANT ======================
// Open to everyone, including visitors who have not signed up.
// If the person is logged in, the assistant knows their role, so it can answer questions about live jobs.
const optionalUser = (req) => {
  try { return jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET); }
  catch { return null; }
};
router.post('/assistant', wrap(async (req, res) => {
  const message = str(req.body.message, 300);
  if (message.length < 2) return bad(res, 'Type a question first.');
  res.json(await assistantAnswer(message, optionalUser(req)));
}));

// ====================== AI AND RECOMMENDATIONS ======================

// Gemini suggests a service for the client's description. The client can always change it.
router.post('/ai/interpret', auth('client'), wrap(async (req, res) => {
  const description = str(req.body.description, 1000);
  if (description.length < 5) return bad(res, 'Describe the job in a few words first.');
  const cats = await ServiceCategory.find({ active: true });
  res.json(await interpret(description, cats));
}));

// Ranked search for clients: uses the job description and the keywords from the suggestion
router.post('/recommend', auth('client'), wrap(async (req, res) => {
  const categoryId = isId(req.body.categoryId) ? req.body.categoryId : null;
  const keywords = (Array.isArray(req.body.keywords) ? req.body.keywords : []).map((k) => str(k, 40)).slice(0, 6);
  res.json(await recommend({ categoryId, location: str(req.body.location, 80), keywords, description: str(req.body.description, 1000), skill: str(req.body.skill, 40) }));
}));

// ---------- CLIENT: review the fundi after the job is completed ----------
router.post('/reviews', auth('client'), wrap(async (req, res) => {
  if (!isId(req.body.jobId)) return bad(res, 'Job not found.', 404);
  const job = await JobRequest.findOne({ _id: req.body.jobId, clientId: req.user.id });
  if (!job) return bad(res, 'Job not found.', 404);
  if (job.status !== 'completed' || !job.hiredFundiId) return bad(res, 'You can review a fundi after the job is completed.');
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return bad(res, 'Choose a rating from 1 to 5.');
  try {
    await Review.create({ jobId: job._id, clientId: req.user.id, fundiId: job.hiredFundiId, rating, comment: str(req.body.comment, 500) });
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === 11000) return bad(res, 'You have already reviewed this job.', 409);   // one review per job
    throw e;
  }
}));

// ====================== THE JOB BOARD ======================

// ---------- CLIENT: post a job ----------
router.post('/jobs', auth('client'), wrap(async (req, res) => {
  const description = str(req.body.description, 1000);
  const phone = str(req.body.phone, 20);
  const location = str(req.body.location, 80);
  if (description.length < 10) return bad(res, 'Describe the job in at least 10 characters.');
  if (!isId(req.body.categoryId) || !(await ServiceCategory.exists({ _id: req.body.categoryId, active: true }))) return bad(res, 'Choose a service.');
  if (!phoneOk(phone)) return bad(res, 'Enter a phone number that the fundi you hire can call.');
  const keywords = (Array.isArray(req.body.keywords) ? req.body.keywords : []).map((k) => str(k, 40)).filter(Boolean).slice(0, 6);
  const job = await JobRequest.create({ clientId: req.user.id, serviceCategoryId: req.body.categoryId, description, location, keywords });
  await User.updateOne({ _id: req.user.id }, { phone, location });
  res.status(201).json({ id: job._id });
}));

// ---------- CLIENT: my jobs ----------
router.get('/jobs/mine', auth('client'), wrap(async (req, res) => {
  const jobs = await JobRequest.find({ clientId: req.user.id }).sort('-createdAt')
    .populate('serviceCategoryId', 'name').populate('hiredFundiId', 'name').lean();
  const counts = await Offer.aggregate([{ $match: { jobId: { $in: jobs.map((j) => j._id) } } }, { $group: { _id: '$jobId', n: { $sum: 1 } } }]);
  const n = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  res.json(jobs.map((j) => ({
    id: j._id, description: j.description, location: j.location, status: j.status, createdAt: j.createdAt,
    category: j.serviceCategoryId && j.serviceCategoryId.name, hired: j.hiredFundiId && j.hiredFundiId.name,
    offerCount: n[String(j._id)] || 0,
  })));
}));

// ---------- CLIENT: one job with its offers, best match first ----------
router.get('/jobs/:id', auth('client'), wrap(async (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'Job not found.', 404);
  const job = await JobRequest.findOne({ _id: req.params.id, clientId: req.user.id }).populate('serviceCategoryId', 'name').lean();
  if (!job) return bad(res, 'Job not found.', 404);
  const offers = await Offer.find({ jobId: job._id }).lean();
  const ranked = await recommend({
    fundiIds: offers.map((o) => o.fundiId), categoryId: String(job.serviceCategoryId._id),
    location: job.location || '', description: job.description, limit: 100,
  });
  const cards = Object.fromEntries(ranked.map((c) => [String(c.fundiId), c]));
  // The hired fundi's phone number is only revealed after the client accepts their offer
  const hired = job.hiredFundiId ? await User.findById(job.hiredFundiId, 'phone').lean() : null;
  // The system recommends the best-matching fundis who have not offered yet (only while the job is open)
  const offered = new Set(offers.map((o) => String(o.fundiId)));
  const invited = new Set((job.invitedFundiIds || []).map(String));
  const recommended = job.status !== 'open' ? [] : (await recommend({
    categoryId: String(job.serviceCategoryId._id), location: job.location || '', keywords: job.keywords || [],
    description: job.description, limit: 12,
  })).filter((f) => !offered.has(String(f.fundiId))).slice(0, 6).map((f) => ({ ...f, invited: invited.has(String(f.fundiId)) }));

  res.json({
    id: job._id, description: job.description, location: job.location, status: job.status, category: job.serviceCategoryId.name,
    reviewed: !!(await Review.exists({ jobId: job._id })),
    recommended,
    offers: offers.filter((o) => cards[String(o.fundiId)]).map((o) => ({
      offerId: o._id, status: o.status, message: o.message || '', price: { amount: o.priceAmount, unit: o.priceUnit },
      fundi: cards[String(o.fundiId)], phone: o.status === 'accepted' ? (hired && hired.phone) || '' : undefined,
    })).sort((a, b) => b.fundi.score - a.fundi.score),
  });
}));

// ---------- CLIENT: accept one offer ----------
router.post('/jobs/:id/offers/:offerId/accept', auth('client'), wrap(async (req, res) => {
  if (!isId(req.params.id) || !isId(req.params.offerId)) return bad(res, 'Offer not found.', 404);
  const job = await JobRequest.findOne({ _id: req.params.id, clientId: req.user.id });
  if (!job) return bad(res, 'Job not found.', 404);
  if (job.status !== 'open') return bad(res, 'This job already has a fundi or is closed.');
  const offer = await Offer.findOne({ _id: req.params.offerId, jobId: job._id, status: 'pending' });
  if (!offer) return bad(res, 'Offer not found.', 404);
  offer.status = 'accepted';
  await offer.save();
  await Offer.updateMany({ jobId: job._id, _id: { $ne: offer._id } }, { status: 'declined' });
  job.status = 'assigned';
  job.hiredFundiId = offer.fundiId;
  await job.save();
  res.json({ ok: true });
}));

// ---------- CLIENT: cancel a job that is still open ----------
router.post('/jobs/:id/cancel', auth('client'), wrap(async (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'Job not found.', 404);
  const job = await JobRequest.findOne({ _id: req.params.id, clientId: req.user.id, status: 'open' });
  if (!job) return bad(res, 'Only an open job can be cancelled.', 404);
  job.status = 'cancelled';
  await job.save();
  await Offer.updateMany({ jobId: job._id }, { status: 'declined' });
  res.json({ ok: true });
}));

// ---------- CLIENT: invite a recommended fundi to send an offer ----------
router.post('/jobs/:id/invite/:fundiId', auth('client'), wrap(async (req, res) => {
  if (!isId(req.params.id) || !isId(req.params.fundiId)) return bad(res, 'Job not found.', 404);
  const job = await JobRequest.findOne({ _id: req.params.id, clientId: req.user.id, status: 'open' });
  if (!job) return bad(res, 'You can only invite fundis to a job that is still open.', 404);
  const profile = await FundiProfile.findOne({ userId: req.params.fundiId }).lean();
  if (!profile || !(profile.serviceCategories || []).some((c) => String(c) === String(job.serviceCategoryId))) return bad(res, 'That fundi does not offer this service.');
  if ((job.invitedFundiIds || []).length >= 5) return bad(res, 'You can invite up to 5 fundis for one job.');
  await JobRequest.updateOne({ _id: job._id }, { $addToSet: { invitedFundiIds: req.params.fundiId } });
  res.json({ ok: true });
}));

// ---------- FUNDI: open jobs that match the services on their profile ----------
router.get('/board', auth('fundi'), wrap(async (req, res) => {
  const profile = await FundiProfile.findOne({ userId: req.user.id }).lean();
  const cats = (profile && profile.serviceCategories) || [];
  // Optional filters from the Find a job menu: a service and/or an area. Jobs always stay within the fundi's own services.
  const wanted = isId(req.query.category) ? req.query.category : null;
  const query = { status: 'open', serviceCategoryId: wanted ? (cats.some((c) => String(c) === wanted) ? wanted : { $in: [] }) : { $in: cats } };
  const area = str(req.query.location, 80);
  if (area) query.location = new RegExp(area.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');   // text match, escaped so it cannot be abused
  const jobs = await JobRequest.find(query).sort('-createdAt').limit(50)
    .populate('serviceCategoryId', 'name').populate('clientId', 'name').lean();
  // Jobs that invited this fundi come first
  const invitedMe = (j) => ((j.invitedFundiIds || []).some((i) => String(i) === req.user.id) ? 1 : 0);
  jobs.sort((a, b) => invitedMe(b) - invitedMe(a));
  const ids = jobs.map((j) => j._id);
  const mine = await Offer.find({ jobId: { $in: ids }, fundiId: req.user.id }).lean();
  const counts = await Offer.aggregate([{ $match: { jobId: { $in: ids } } }, { $group: { _id: '$jobId', n: { $sum: 1 } } }]);
  const myBy = Object.fromEntries(mine.map((o) => [String(o.jobId), o]));
  const n = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  res.json({
    hasServices: cats.length > 0,
    jobs: jobs.map((j) => ({
      id: j._id, description: j.description, location: j.location, createdAt: j.createdAt,
      category: j.serviceCategoryId && j.serviceCategoryId.name, client: j.clientId && j.clientId.name,
      offerCount: n[String(j._id)] || 0, invited: !!invitedMe(j),
      myOffer: myBy[String(j._id)] ? { status: myBy[String(j._id)].status, price: { amount: myBy[String(j._id)].priceAmount, unit: myBy[String(j._id)].priceUnit } } : null,
    })),
  });
}));

// ---------- FUNDI: send an offer (the price comes from their profile) ----------
router.post('/jobs/:id/offers', auth('fundi'), wrap(async (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'Job not found.', 404);
  const [profile, user] = await Promise.all([FundiProfile.findOne({ userId: req.user.id }).lean(), User.findById(req.user.id, 'phone').lean()]);
  if (!profile || !profile.rate || profile.rate.amount == null) return bad(res, 'Add your price to your profile before sending offers.');
  if (!user || !phoneOk(user.phone || '')) return bad(res, 'Add your phone number to your profile before sending offers.');
  const job = await JobRequest.findOne({ _id: req.params.id, status: 'open' });
  if (!job) return bad(res, 'This job is no longer open.', 404);
  if (!(profile.serviceCategories || []).some((c) => String(c) === String(job.serviceCategoryId))) return bad(res, 'This job is outside the services on your profile.', 403);
  try {
    await Offer.create({ jobId: job._id, fundiId: req.user.id, message: str(req.body.message, 300), priceAmount: profile.rate.amount, priceUnit: profile.rate.unit || 'per job' });
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === 11000) return bad(res, 'You have already sent an offer for this job.', 409);
    throw e;
  }
}));

// ---------- FUNDI: my offers (the client's phone shows once they accept) ----------
router.get('/offers/mine', auth('fundi'), wrap(async (req, res) => {
  const offers = await Offer.find({ fundiId: req.user.id }).sort('-createdAt').limit(50)
    .populate({ path: 'jobId', populate: [{ path: 'serviceCategoryId', select: 'name' }, { path: 'clientId', select: 'name phone' }] }).lean();
  res.json(offers.filter((o) => o.jobId).map((o) => {
    const j = o.jobId;
    const hired = o.status === 'accepted' && String(j.hiredFundiId) === req.user.id;
    return {
      offerId: o._id, status: o.status, price: { amount: o.priceAmount, unit: o.priceUnit },
      job: {
        id: j._id, description: j.description, location: j.location, status: j.status,
        category: j.serviceCategoryId && j.serviceCategoryId.name, client: j.clientId && j.clientId.name,
        clientPhone: hired ? (j.clientId && j.clientId.phone) || '' : undefined,
      },
    };
  }));
}));

// ---------- FUNDI: mark a hired job as completed ----------
router.post('/jobs/:id/complete', auth('fundi'), wrap(async (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'Job not found.', 404);
  const job = await JobRequest.findOne({ _id: req.params.id, hiredFundiId: req.user.id, status: 'assigned' });
  if (!job) return bad(res, 'Job not found.', 404);
  job.status = 'completed';
  await job.save();
  res.json({ ok: true });
}));

// ====================== ADMINISTRATION ======================

// A short summary of what is on the platform
router.get('/admin/stats', auth('admin'), wrap(async (req, res) => {
  const [clients, fundis, total, offers, reviews, byStatus] = await Promise.all([
    User.countDocuments({ role: 'client' }), User.countDocuments({ role: 'fundi' }), JobRequest.countDocuments(),
    Offer.countDocuments(), Review.countDocuments(), JobRequest.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const s = Object.fromEntries(byStatus.map((x) => [x._id, x.n]));
  res.json({ clients, fundis, offers, reviews, jobs: { total, open: s.open || 0, assigned: s.assigned || 0, completed: s.completed || 0, cancelled: s.cancelled || 0 } });
}));

// Everyone who has an account (passwords are never sent)
router.get('/admin/users', auth('admin'), wrap(async (req, res) => {
  const users = await User.find({}, 'name email role createdAt').sort('-createdAt').lean();
  res.json(users.map((u) => ({ id: u._id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt })));
}));

// Remove a user and what belongs to them
router.delete('/admin/users/:id', auth('admin'), wrap(async (req, res) => {
  if (!isId(req.params.id)) return bad(res, 'User not found.', 404);
  const user = await User.findById(req.params.id);
  if (!user) return bad(res, 'User not found.', 404);
  if (user.role === 'admin') return bad(res, 'Administrator accounts cannot be removed here.', 403);
  const id = user._id;
  const jobIds = (await JobRequest.find({ clientId: id }, '_id').lean()).map((j) => j._id);
  await Promise.all([
    Offer.deleteMany({ $or: [{ fundiId: id }, { jobId: { $in: jobIds } }] }),
    Review.deleteMany({ $or: [{ fundiId: id }, { clientId: id }] }),
    JobRequest.deleteMany({ clientId: id }),
    // A job that had hired this fundi goes back to open, so its client can choose someone else
    JobRequest.updateMany({ hiredFundiId: id, status: 'assigned' }, { status: 'open', $unset: { hiredFundiId: 1 } }),
    FundiProfile.deleteOne({ userId: id }),
    PortfolioItem.deleteMany({ fundiId: id }),
    Message.deleteMany({ $or: [{ senderId: id }, { recipientId: id }, { jobId: { $in: jobIds } }] }),
  ]);
  await user.deleteOne();
  res.json({ ok: true });
}));

// Profile photos (/me/photo, /users/:id/photo) and the public /stats numbers live in extras.js
require('./extra')(router, { auth, wrap, bad, readPhoto });

module.exports = router;