// The five things the platform stores. Each "model" becomes a MongoDB collection.
const { Schema, model } = require('mongoose');

// Shortcut for "this field holds the id of a document in another collection"
const ref = (name, extra = {}) => ({ type: Schema.Types.ObjectId, ref: name, ...extra });

// 1. USERS: everyone who can log in
const User = model('User', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },          // never the real password
  role: { type: String, enum: ['client', 'fundi', 'admin'], default: 'client' },
  phone: { type: String, trim: true, maxlength: 20 },      // private until a client hires the fundi
  location: { type: String, trim: true, maxlength: 80 },   // client's area (shown on their profile)
}, { timestamps: true }));

// 2. SERVICE CATEGORIES: plumbing, electrical and so on
const ServiceCategory = model('ServiceCategory', new Schema({
  name: { type: String, required: true, unique: true },
  description: String,
  active: { type: Boolean, default: true },
}));

// 3. FUNDI PROFILES: what a fundi offers, including their price
const FundiProfile = model('FundiProfile', new Schema({
  userId: ref('User', { required: true, unique: true }),   // one profile per fundi
  skills: [String],
  serviceCategories: [ref('ServiceCategory')],
  location: { type: String, trim: true, maxlength: 80, index: true },
  experienceYears: { type: Number, min: 0, max: 60 },
  availability: { type: String, enum: ['available', 'busy', 'unspecified'], default: 'unspecified' },
  description: { type: String, maxlength: 600 },
  rate: {                                                   // the fundi's own price, in Kenyan shillings
    amount: { type: Number, min: 0, max: 1000000 },
    unit: { type: String, enum: ['per job', 'per hour', 'per day'], default: 'per job' },
  },
}));

// 4. JOB REQUESTS: posted by a client onto the open job board
const JobRequest = model('JobRequest', new Schema({
  clientId: ref('User', { required: true, index: true }),
  serviceCategoryId: ref('ServiceCategory', { required: true }),
  description: { type: String, required: true, maxlength: 1000 },
  location: { type: String, trim: true, maxlength: 80 },
  status: { type: String, enum: ['open', 'assigned', 'completed', 'cancelled'], default: 'open', index: true },
  hiredFundiId: ref('User'),                               // set when the client accepts an offer
}, { timestamps: true }));

// 5. OFFERS: a fundi's response to a posted job
const offerSchema = new Schema({
  jobId: ref('JobRequest', { required: true, index: true }),
  fundiId: ref('User', { required: true, index: true }),
  message: { type: String, trim: true, maxlength: 300 },
  priceAmount: { type: Number, min: 0, required: true },   // copied from the fundi's rate when they offer
  priceUnit: { type: String, enum: ['per job', 'per hour', 'per day'], required: true },
  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
}, { timestamps: true });
offerSchema.index({ jobId: 1, fundiId: 1 }, { unique: true });   // one offer per fundi per job
const Offer = model('Offer', offerSchema);

// 6. REVIEWS: client's rating after the job is completed
const Review = model('Review', new Schema({
  jobId: ref('JobRequest', { required: true, unique: true }),    // one review per job
  clientId: ref('User', { required: true }),
  fundiId: ref('User', { required: true, index: true }),
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, maxlength: 500 },
}, { timestamps: true }));

module.exports = { User, ServiceCategory, FundiProfile, JobRequest, Offer, Review };