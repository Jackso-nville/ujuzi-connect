// Starts the web server: serves the frontend, will serve the API, and connects to MongoDB.
require('dotenv').config();                        // loads the secrets from backend/.env
const path = require('path');
const fs = require('fs');
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');                  // adds standard security headers
const rateLimit = require('express-rate-limit');   // slows down repeated requests
require('./models');                               // registers the collections
const { seed } = require('./seed');               // loads categories and the admin account

// Refuse to start with a missing or placeholder secret
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me') {
  console.error('Set a strong JWT_SECRET in backend/.env before starting.');
  process.exit(1);
}

const app = express();
app.use(helmet());
// Photos arrive as text inside the request, so the photo route is allowed a bigger request than the rest
app.use('/api/portfolio', express.json({ limit: '1.5mb' }));
app.use(express.json({ limit: '20kb' }));          // lets the server read JSON sent by the browser
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 50 }));
app.use('/api/auth/forgot', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));   // stops anyone flooding reset emails
app.use('/api/ai', rateLimit({ windowMs: 60 * 1000, max: 15 }));
app.use('/api/messages', rateLimit({ windowMs: 60 * 1000, max: 120 }));
app.use('/api/assistant', rateLimit({ windowMs: 60 * 1000, max: 20 }));   // the assistant can use Gemini, so keep it limited   // chat refreshes often, but not endlessly

// A simple check that the server and database are alive
app.get('/api/health', (req, res) => {
  res.json({ ok: true, database: mongoose.connection.readyState === 1 ? 'connected' : 'not connected' });
});

// The API: sign up, log in, categories (more is added in later stages)
app.use('/api', require('./routes'));

// Serve the website from the frontend folder (one level up from backend)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Errors are logged for you; users never see technical details
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// Connect to MongoDB. Three ways, chosen by MONGODB_URI in backend/.env:
//   mongodb://127.0.0.1:27017/ujuzi_connect   MongoDB installed on this computer
//   a mongodb+srv://... address               MongoDB Atlas
//   embedded                                  a built-in development database (no install needed)
async function connect() {
  let uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ujuzi_connect';
  if (uri === 'embedded') {
    const { MongoMemoryServer } = require('mongodb-memory-server'); // npm install --save-dev mongodb-memory-server
    const dbPath = path.join(__dirname, '.data');                   // data is saved here between runs
    fs.mkdirSync(dbPath, { recursive: true });
    const embedded = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger' } });
    uri = embedded.getUri('ujuzi_connect');
    console.log('Using the embedded development database. Data is saved in backend/.data');
  }
  await mongoose.connect(uri);
}

const port = process.env.PORT || 3000;
connect()
  .then(seed)
  .then(() => app.listen(port, () => console.log('Ujuzi Connect running at http://localhost:' + port)))
  .catch((e) => { console.error('Database connection failed:', e.message); process.exit(1); });