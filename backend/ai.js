// Ranks fundis for a client. The ranking uses fixed, documented weights (no AI guessing).
// Stage 5 adds the Gemini part (interpret) to this same file.
const { FundiProfile, Review } = require('./models');

// Splits text into useful lowercase words (ignores tiny and common words)
const STOP = new Set(['the', 'and', 'for', 'with', 'has', 'have', 'need', 'someone', 'please', 'that', 'this', 'under', 'from', 'but', 'not', 'are', 'its', 'my', 'is', 'in', 'on', 'at', 'to', 'of', 'a', 'it', 'me', 'i']);
const tokens = (t) => (String(t || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));

// The weights add up to 100. Missing information earns half marks, so a new fundi is never punished.
const W = { category: 30, skills: 25, location: 20, availability: 10, rating: 15 };

async function recommend({ categoryId, location = '', keywords = [], description = '' }) {
  // Only fundis who offer the chosen service (or everyone if no service is chosen)
  const profiles = await FundiProfile.find(categoryId ? { serviceCategories: categoryId } : {})
    .populate('userId', 'name').populate('serviceCategories', 'name').lean();
  const live = profiles.filter((p) => p.userId);

  // Average rating and number of reviews for each fundi
  const stats = await Review.aggregate([
    { $match: { fundiId: { $in: live.map((p) => p.userId._id) } } },
    { $group: { _id: '$fundiId', avg: { $avg: '$rating' }, n: { $sum: 1 } } },
  ]);
  const byId = Object.fromEntries(stats.map((s) => [String(s._id), s]));

  const want = new Set([...keywords.flatMap(tokens), ...tokens(description)]);
  const loc = String(location).trim().toLowerCase();

  return live.map((p) => {
    const reasons = [];
    let score = categoryId ? W.category : W.category / 2;
    if (categoryId) reasons.push('Offers this service');

    // Skills: how many of the fundi's skills appear in the job description
    const skills = new Set((p.skills || []).flatMap(tokens));
    if (!skills.size || !want.size) score += W.skills / 2;
    else {
      const hits = [...skills].filter((t) => want.has(t));
      score += W.skills * Math.min(1, hits.length / 3);
      if (hits.length) reasons.push('Skills match: ' + hits.slice(0, 3).join(', '));
    }

    // Location: same area scores full, nearby text match scores 70%
    const pl = (p.location || '').toLowerCase();
    if (!loc || !pl) score += W.location / 2;
    else if (pl === loc) { score += W.location; reasons.push('Works in ' + p.location); }
    else if (pl.includes(loc) || loc.includes(pl)) { score += W.location * 0.7; reasons.push('Works near ' + p.location); }

    // Availability
    score += W.availability * (p.availability === 'available' ? 1 : p.availability === 'busy' ? 0 : 0.5);
    if (p.availability === 'available') reasons.push('Available now');

    // Ratings: pulled towards 3 when there are few reviews, so one review cannot dominate
    const st = byId[String(p.userId._id)];
    const n = st ? st.n : 0;
    score += W.rating * (n ? ((st.avg * n + 6) / (n + 2)) / 5 : 0.5);
    if (n) reasons.push(`Rated ${st.avg.toFixed(1)} from ${n} review${n > 1 ? 's' : ''}`);

    return {
      fundiId: p.userId._id, name: p.userId.name, location: p.location || '', skills: p.skills || [],
      services: (p.serviceCategories || []).map((c) => c.name), availability: p.availability,
      experienceYears: p.experienceYears, description: p.description || '', rate: p.rate || null,
      rating: n ? Number(st.avg.toFixed(1)) : null, reviewCount: n, score: Math.round(score), reasons,
    };
  }).sort((a, b) => b.score - a.score).slice(0, 20);
}

module.exports = { recommend, tokens };