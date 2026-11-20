// Profile photos and the public network numbers. Mounted from routes.js.
const mongoose = require('mongoose');
const { User, JobRequest, Review } = require('./models');

module.exports = (router, { auth, wrap, bad, readPhoto }) => {
  const anyone = auth('client', 'fundi', 'admin');

  // Save my profile photo (a small JPG, PNG or WebP, checked by its first bytes)
  router.put('/me/photo', anyone, wrap(async (req, res) => {
    const p = readPhoto(req.body.image);
    if (!p) return bad(res, 'Upload a JPG, PNG or WebP photo under 800 KB.');
    await User.updateOne({ _id: req.user.id }, { photo: p.image, photoType: p.contentType, hasPhoto: true });
    res.json({ ok: true });
  }));

  // Remove my profile photo
  router.delete('/me/photo', anyone, wrap(async (req, res) => {
    await User.updateOne({ _id: req.user.id }, { $unset: { photo: 1, photoType: 1 }, hasPhoto: false });
    res.json({ ok: true });
  }));

  // Anyone can see a profile photo, like the photos of work
  router.get('/users/:id/photo', wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
    const u = await User.findById(req.params.id).select('+photo +photoType hasPhoto');
    if (!u || !u.hasPhoto || !u.photo) return res.status(404).end();
    res.set({ 'Content-Type': u.photoType, 'Cache-Control': 'no-cache' });
    res.send(u.photo);
  }));

  // Real numbers for the footer of the home page
  router.get('/stats', wrap(async (req, res) => {
    const [fundis, completed, reviews, openJobs] = await Promise.all([
      User.countDocuments({ role: 'fundi' }), JobRequest.countDocuments({ status: 'completed' }),
      Review.countDocuments(), JobRequest.countDocuments({ status: 'open' }),
    ]);
    res.json({ fundis, completed, reviews, openJobs });
  }));
};