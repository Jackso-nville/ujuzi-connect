
// Live answers for the Ujuzi Connect help assistant.
// Checks MongoDB for open jobs and fundi availability.
// Recognises service problems described in everyday language.
// Shows fundi names only, never phone numbers or email addresses.

const {
  JobRequest,
  ServiceCategory,
  FundiProfile,
  User
} = require('./models');

// --------------------------------------------------
// 1. Helper functions
// --------------------------------------------------

const rx = (s) =>
  new RegExp(
    String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'i'
  );

const ago = (d) => {
  const n = Math.floor((Date.now() - new Date(d)) / 86400000);
  return n < 1 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago';
};

const title = (s) =>
  s.replace(/\b\w/g, (c) => c.toUpperCase());

const reply = (answer, action = null) => ({
  source: 'live',
  answer,
  action
});

// --------------------------------------------------
// 2. Understand different words and expressions
// --------------------------------------------------

const SYNONYMS = [
  // Plumbing
  [
    /\b(plumbers?|pipe fitters?|taps?|faucets?|pipes?|drains?|leaks?|leaking|dripping|dripped|drip|burst pipes?|blocked drains?|clogged drains?|water pipes?)\b/g,
    ' plumbing '
  ],

  // Electrical work
  [
    /\b(electricians?|electrical technicians?|wiring|sockets?|switches?|power outlets?|circuit breakers?)\b/g,
    ' electrical '
  ],

  // Carpentry
  [
    /\b(carpenters?|woodworkers?|cabinet makers?|wardrobes?|wooden doors?|wooden furniture)\b/g,
    ' carpentry '
  ],

  // Painting
  [
    /\b(painters?|decorators?|wall painting|paint job)\b/g,
    ' painting '
  ],

  // Masonry
  [
    /\b(bricklayers?|brick masons?|masons?|brickwork|blockwork|bricks?|building walls?|concrete work)\b/g,
    ' masonry '
  ],

  // Welding
  [
    /\b(welders?|metal fabricators?|metal gates?|broken gates?)\b/g,
    ' welding '
  ],

  // Appliance repair
  [
    /\b(appliance technicians?|repair technicians?|fridges?|refrigerators?|microwaves?|ovens?|washing machines?|cookers?)\b/g,
    ' appliance repair '
  ],

  // Availability
  [/\b(occupied|not free|unavailable|not available)\b/g, ' busy '],
  [/\b(ready to work)\b/g, ' available '],

  // People and services
  [/\b(artisans|workers|technicians|service providers)\b/g, ' fundis '],

  // Hiring and finding
  [/\b(employ|employing|looking to employ)\b/g, ' hire '],
  [/\b(find someone|look for someone|search for someone)\b/g, ' find a fundi '],

  // Jobs
  [/\b(vacancies|openings|gigs|opportunities)\b/g, ' jobs ']
];

function understandWords(message) {
  let result = String(message || '')
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const [pattern, replacement] of SYNONYMS) {
    result = result.replace(pattern, replacement);
  }

  return ' ' + result.replace(/\s+/g, ' ').trim() + ' ';
}

// --------------------------------------------------
// 3. Service category recognition
// --------------------------------------------------

const CATEGORY_ALIASES = {
  plumbing: [
    'plumbing',
    'plumber',
    'pipe'
  ],

  electrical: [
    'electrical',
    'electrician',
    'electric'
  ],

  carpentry: [
    'carpentry',
    'carpenter',
    'woodwork'
  ],

  painting: [
    'painting',
    'painter'
  ],

  masonry: [
    'masonry',
    'mason',
    'bricklayer',
    'brickwork'
  ],

  welding: [
    'welding',
    'welder'
  ],

  'appliance repair': [
    'appliance repair',
    'appliance',
    'fridge repair'
  ]
};

function matchesWord(message, word) {
  return new RegExp(
    '\\b' +
    String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '\\b',
    'i'
  ).test(message);
}

function findCategory(categories, message) {
  return categories.find((category) => {
    const categoryName = String(category.name || '').toLowerCase();

    if (matchesWord(message, categoryName)) {
      return true;
    }

    return Object.values(CATEGORY_ALIASES).some((aliases) => {
      const categoryMatches = aliases.some((alias) =>
        categoryName.includes(alias)
      );

      const messageMatches = aliases.some((alias) =>
        matchesWord(message, alias)
      );

      return categoryMatches && messageMatches;
    });
  });
}

// --------------------------------------------------
// 4. Recognise user intentions
// --------------------------------------------------

function understandIntent(m) {
  const asks =
    /\b(are there|is there|any|how many|available|busy|free|have you got|show me|latest|new|currently|right now|today|do you have|can someone|can you|could someone|could you)\b/.test(m);

  const howTo =
    /\b(how do|how can|how to|how does|where do)\b/.test(m);

  const wantsJobs =
    /\b(jobs?|work|vacanc\w+|gigs?|openings?)\b/.test(m) &&
    (
      asks ||
      /\b(find|search|looking for|need|show)\b/.test(m)
    ) &&
    !howTo;

  const serviceWords =
    /\b(fundis?|plumbing|electrical|carpentry|painting|welding|masonry|appliance repair)\b/.test(m);

  const problemWords =
    /\b(help|someone|somebody|need someone|fix|repair|install|broken|dripping|leaking|leak|burst|blocked|clogged|not working|stopped working|faulty|damaged|problem|issue|replace|build|construct|paint)\b/.test(m);

  const wantsFundis =
    !wantsJobs &&
    !howTo &&
    serviceWords &&
    (
      asks ||
      problemWords ||
      /\b(need|want|find|search|looking for|hire|get me|show me)\b/.test(m)
    );

  return {
    asks,
    howTo,
    wantsJobs,
    wantsFundis
  };
}

// --------------------------------------------------
// 5. Main live-answer function
// --------------------------------------------------

async function liveAnswer(message, user) {
  const originalMessage = String(message || '').trim();

  if (!originalMessage) return null;

  const m = understandWords(originalMessage);
  const intent = understandIntent(m);

  const {
    asks,
    howTo,
    wantsJobs,
    wantsFundis
  } = intent;

  const role = user && user.role;

  // ------------------------------------------------
  // 6. Check whether a named fundi is available
  // ------------------------------------------------

  const personMatch =
    /\b(?:is|are)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)\s+(?:available|free|busy|occupied)\b/i.exec(
      originalMessage
    );

  if (personMatch && asks && !howTo) {
    const personName = personMatch[1].trim();

    const excluded = [
      'there',
      'any',
      'someone',
      'somebody',
      'a fundi'
    ];

    if (!excluded.includes(personName.toLowerCase())) {
      const matchingUsers = await User.find({
        role: 'fundi',
        name: rx(personName)
      })
        .select('_id name')
        .limit(10)
        .lean();

      if (!matchingUsers.length) {
        return reply(
          `I couldn't find a fundi named ${title(personName)} on Ujuzi Connect. Please check the spelling or search our fundi directory.`,
          { label: 'Search fundis', go: 'find' }
        );
      }

      const profiles = await FundiProfile.find({
        userId: {
          $in: matchingUsers.map((u) => u._id)
        }
      })
        .populate('userId', 'name')
        .lean();

      if (!profiles.length) {
        return reply(
          `${title(personName)} has an account, but I couldn't find a fundi profile to confirm their availability.`
        );
      }

      const results = profiles.map((p) => {
        const name = p.userId?.name || personName;

        if (p.availability === 'available') {
          return `${name} is marked as available on their profile.`;
        }

        if (p.availability === 'busy') {
          return `${name} is marked as busy on their profile.`;
        }

        return `${name}'s availability has not been specified on their profile.`;
      });

      return reply(
        results.join(' ') +
        ' Profile availability does not guarantee immediate availability. Please contact the fundi to confirm before arranging work.',
        { label: 'Search fundis', go: 'find' }
      );
    }
  }

  // ------------------------------------------------
  // 7. Identify service category and location
  // ------------------------------------------------

  if (!wantsJobs && !wantsFundis) {
    return null;
  }

  const cats = await ServiceCategory.find({
    active: true
  }).lean();

  const cat = findCategory(cats, m);

  const tidy = m
    .replace(/\b(right now|at the moment|today|currently|now|please)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let where =
    (/\b(?:in|near|around|at)\s+([a-z][a-z ]{1,28})$/.exec(tidy) || [])[1] ||
    null;

  if (
    where &&
    cat &&
    where.startsWith(cat.name.toLowerCase())
  ) {
    where = null;
  }

  // Avoid treating general words as actual locations.
  if (
    where &&
    /^(me|there|here|my area|my location)$/.test(where.trim())
  ) {
    where = null;
  }

  const place = where ? ' in ' + title(where) : '';
  const name = cat ? cat.name.toLowerCase() : '';

  // ------------------------------------------------
  // 8. Check open jobs in MongoDB
  // ------------------------------------------------

  if (wantsJobs) {
    const q = { status: 'open' };
    let mine = false;

    if (cat) {
      q.serviceCategoryId = cat._id;
    } else if (role === 'fundi') {
      const p = await FundiProfile.findOne({
        userId: user.id
      }).lean();

      if (p && (p.serviceCategories || []).length) {
        q.serviceCategoryId = {
          $in: p.serviceCategories
        };

        mine = true;
      }
    }

    if (where) {
      q.location = rx(where);
    }

    const n = await JobRequest.countDocuments(q);

    const label =
      `${name ? name + ' ' : ''}job${n === 1 ? '' : 's'}` +
      `${place}` +
      `${mine ? ' for the services on your profile' : ''}`;

    const board =
      role === 'fundi'
        ? { label: 'Open the job board', act: 'findjob' }
        : null;

    if (!n) {
      return reply(
        `There are no open ${label} right now. Clients post new jobs often, so check again soon.`,
        board
      );
    }

    const head =
      `Yes. There ${n === 1 ? 'is 1 open' : 'are ' + n + ' open'} ${label} right now.`;

    if (role === 'fundi') {
      const list = await JobRequest.find(q)
        .sort('-createdAt')
        .limit(3)
        .populate('serviceCategoryId', 'name')
        .lean();

      return reply(
        head +
        ' Latest: ' +
        list.map((j) =>
          `${j.serviceCategoryId ? j.serviceCategoryId.name : 'Job'}` +
          `${j.location ? ' in ' + j.location : ''}` +
          ` (${ago(j.createdAt)})`
        ).join('; ') +
        '.',
        board
      );
    }

    if (role === 'client') {
      return reply(
        head + ' Those were posted by other clients. You can post your own job too.',
        { label: 'Post a job', act: 'postjob' }
      );
    }

    if (role) {
      return reply(head);
    }

    return reply(
      head + ' Sign up as a fundi to see the details and send offers.',
      { label: 'Sign up as a fundi', act: 'signupfundi' }
    );
  }

  // ------------------------------------------------
  // 9. Find fundis by service, location and availability
  // ------------------------------------------------

  const q = cat
    ? { serviceCategories: cat._id }
    : {};

  if (where) {
    q.location = rx(where);
  }

  const requestedStatus =
    /\bbusy\b/.test(m) ? 'busy' : 'available';

  const [
    total,
    matchingCount,
    matchingFundis
  ] = await Promise.all([
    FundiProfile.countDocuments(q),

    FundiProfile.countDocuments({
      ...q,
      availability: requestedStatus
    }),

    FundiProfile.find({
      ...q,
      availability: requestedStatus
    })
      .populate('userId', 'name')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean()
  ]);

  const action = role
    ? { label: 'Search fundis', go: 'find' }
    : { label: 'Create a free account', act: 'auth', mode: 'register' };

  const statusLabel =
    requestedStatus === 'busy' ? 'busy' : 'available';

  if (!total) {
    return reply(
      `No fundis${name ? ' offering ' + name : ''}${place} have joined yet.`,
      action
    );
  }

  if (!matchingCount) {
    return reply(
      `${total} fundi${total === 1 ? '' : 's'} offer ${
        name || 'these services'
      }${place}, but none are currently marked as ${statusLabel} on their profiles.`,
      action
    );
  }

  const names = matchingFundis
    .filter((f) => f.userId && f.userId.name)
    .map((f) => f.userId.name);

  return reply(
    `Yes! ${matchingCount} fundi${
      matchingCount === 1 ? '' : 's'
    } offering ${name || 'these services'}${place} ${
      matchingCount === 1 ? 'is' : 'are'
    } marked as ${statusLabel}. ` +
    (names.length
      ? `Here ${names.length === 1 ? 'is' : 'are'} ${
          names.length === 1 ? 'the fundi' : 'some of the fundis'
        }: ${names.join(', ')}. `
      : '') +
    'This information comes from their profile status and does not guarantee immediate appointment availability. Please contact them to confirm.',
    action
  );
}

module.exports = { liveAnswer };
