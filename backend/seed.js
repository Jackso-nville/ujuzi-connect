// Puts the starting data into the database: the service categories and (optionally) the administrator.
// The server runs this automatically every time it starts. It is safe to run many times.
// Add SEED_DEMO=true to .env to also create three sample fundis (password: Demo12345!).
require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { User, ServiceCategory, FundiProfile } = require('./models.js');

const CATEGORIES = [
  'Plumbing',
  'Electrical installation',
  'Carpentry',
  'Masonry',
  'Painting',
  'Welding',
  'Appliance repair',
  'Tailoring'
];
const DEMO = [
  { name: 'Peter Otieno', email: 'peter@demo.test', cats: ['Plumbing'], skills: ['pipe repair', 'leak detection', 'drain unblocking'], location: 'Nairobi', years: 8, availability: 'available', rate: { amount: 1500, unit: 'per job' }, about: 'Plumber with eight years of experience in homes and small businesses.' },
  { name: 'Grace Wanjiru', email: 'grace@demo.test', cats: ['Electrical installation', 'Appliance repair'], skills: ['wiring', 'socket repair', 'fridge repair'], location: 'Nairobi', years: 5, availability: 'available', rate: { amount: 800, unit: 'per hour' }, about: 'Electrician who also repairs fridges and cookers.' },
  { name: 'John Kamau', email: 'john@demo.test', cats: ['Carpentry', 'Masonry'], skills: ['doors', 'cupboards', 'tiling'], location: 'Thika', years: 12, availability: 'busy', rate: { amount: 2500, unit: 'per day' }, about: 'Carpenter and mason. Custom cupboards and tiling.' },
];

async function seed() {
  for (const name of CATEGORIES) {
    await ServiceCategory.updateOne({ name }, { $setOnInsert: { name, active: true } }, { upsert: true });
  }

  // Create the administrator account from the settings in .env (only once).
  // The server says in the terminal what it did, so a missing account is easy to explain.
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) {
    console.log('Administrator NOT created: ADMIN_EMAIL or ADMIN_PASSWORD is missing in backend/.env');
  } else if (password.length < 8) {
    console.log('Administrator NOT created: ADMIN_PASSWORD must have at least 8 characters');
  } else {
    const existing = await User.findOne({ email }, 'role').lean();
    if (existing) {
      console.log(`Administrator NOT created: an account with ${email} already exists (role: ${existing.role})`);
    } else {
      await User.create({ name: 'Administrator', email, role: 'admin', passwordHash: await bcrypt.hash(password, 12) });
      console.log('Administrator account created for ' + email);
    }
  }

  if (process.env.SEED_DEMO === 'true') {
    const cats = Object.fromEntries((await ServiceCategory.find()).map((c) => [c.name, c._id]));
    for (const d of DEMO) {
      if (await User.exists({ email: d.email })) continue;
      const u = await User.create({ name: d.name, email: d.email, role: 'fundi', passwordHash: await bcrypt.hash('Demo12345!', 12) });
      await FundiProfile.create({ userId: u._id, skills: d.skills, serviceCategories: d.cats.map((c) => cats[c]), location: d.location, experienceYears: d.years, availability: d.availability, rate: d.rate, description: d.about });
      console.log('Demo fundi added: ' + d.name);
    }
  }
}

module.exports = { seed };

if (require.main === module) {
  mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ujuzi_connect')
    .then(seed)
    .then(() => { console.log('Seed complete.'); return mongoose.disconnect(); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}