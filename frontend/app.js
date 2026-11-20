// Ujuzi Connect: the browser code.
// Stage 16 adds: clickable service cards on the home page, and safer handling of the footer network.

// ---------- Small helpers ----------
const $ = (selector) => document.querySelector(selector);

// Makes text safe to put on the page (stops injected code)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Remembers who is logged in (kept in the browser so a refresh does not log you out)
const state = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  cats: [],
  tab: 'profile',   // which part of the fundi dashboard is open
  kw: [],           // keywords from the AI suggestion, used to rank fundis
  boardFilter: { category: '', location: '' },   // filters on the fundi's job board
  bot: [],          // the assistant chat: { who: 'user' | 'bot', text, action }
  unread: 0,        // unread messages, shown as a badge in the menu
  chat: null,       // the conversation that is open: { jobId, fundiId }
  prefill: null,    // a job typed on the home page, carried over to the Post a job form
};

// Talks to the backend. Every request goes through here.
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { saveSession(null); show('auth'); }   // login expired: ask to log in again
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

// Shows a message in green (ok) or red (error) inside the element you give it
function showMessage(el, text, ok) {
  if (!el) return;
  el.textContent = text;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
}
// The message line of whichever screen is open right now
const visibleMessage = () => document.querySelector('main > section:not([hidden]) .msg');
const currentView = () => document.querySelector('main > section:not([hidden])').id.replace('view-', '');

// Text helpers
const money = (r) => (r && r.amount != null ? `KES ${Number(r.amount).toLocaleString()} ${r.unit}` : 'Price not set');
const availabilityText = { available: 'Available now', busy: 'Busy at the moment', unspecified: 'Availability not stated' };
const statusLabel = { open: 'open', assigned: 'fundi hired', completed: 'completed', cancelled: 'cancelled', pending: 'pending', accepted: 'accepted', declined: 'declined' };
const statusClass = { open: 'pending', assigned: 'accepted', cancelled: 'declined' };
const statusTag = (s) => `<span class="tag ${statusClass[s] || s}">${esc(statusLabel[s] || s)}</span>`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const day = (d) => new Date(d).toLocaleDateString();

// ---------- Login state ----------
function saveSession(data) {
  state.token = data ? data.token : null;
  state.user = data ? data.user : null;
  state.unread = 0;
  if (data) {
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
  } else {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }
  renderNav();
}

// Draws the top menu (computers) and the three-line menu (phones) for whoever is using the site
function renderNav() {
  const u = state.user;
  const label = u && { client: 'My jobs', fundi: 'My dashboard', admin: 'Administration' }[u.role];
  const catList = (act) => state.cats.map((c) => `<button class="opt" data-act="${act}" data-id="${esc(c.id)}">${esc(c.name)}</button>`).join('');
  // A dropdown: a button with a small arrow, and a panel that opens under it
  const dropdown = (key, text, body, right) => `<div class="dd">
    <button data-dd="${key}" aria-expanded="false" aria-controls="dd-${key}">${text}<span class="caret"></span></button>
    <div class="dd-panel${right ? ' right' : ''}" id="dd-${key}" hidden>${body}</div></div>`;

  const hire = dropdown('hire', 'Hire a fundi', `
    <div class="dd-col"><h4>By service</h4>${catList('hirecat')}</div>
    <div class="dd-col">
      <h4>By area</h4><input id="dd-loc" data-enter="hireloc" maxlength="80" placeholder="Nairobi" aria-label="Area"><button class="go" data-act="hireloc">Search</button>
      <h4>By skill</h4><input id="dd-skill" data-enter="hireskill" maxlength="40" placeholder="wiring" aria-label="Skill"><button class="go" data-act="hireskill">Search</button>
    </div>`);
  const jobs = dropdown('jobs', 'Find a job', u && u.role === 'fundi' ? `
    <div class="dd-col"><h4>By service</h4>${catList('jobcat')}</div>
    <div class="dd-col">
      <h4>By area</h4><input id="dd-jloc" data-enter="jobloc" maxlength="80" placeholder="Nairobi" aria-label="Area"><button class="go" data-act="jobloc">Search</button>
      <p class="hint">Shows open jobs for the services on your profile.</p>
    </div>` : `
    <div class="dd-col"><p class="hint">Fundis can see open jobs after they sign up.</p><button class="go" data-act="signupfundi">Sign up as a fundi</button></div>`);

  const left = (!u || u.role === 'client' ? hire : '') + (!u || u.role === 'fundi' ? jobs : '');
  const badge = state.unread > 0 ? `<span class="badge">${state.unread}</span>` : '';
  const messagesButton = u && u.role !== 'admin' ? `<button data-act="inbox">Messages${badge}</button>` : '';
  const postJobButton = '<button class="postjob" data-act="postjob">Post a job</button>';
  const right = u
    ? (u.role === 'client' ? postJobButton : '') + messagesButton + `<button data-go="dash">${label}</button>` + dropdown('user',
        `${avatar(u.id, u.name, u.hasPhoto, 'nav-avatar')} <span>${esc(u.name)}</span>`,
        `<div class="dd-col"><p><b>${esc(u.name)}</b><br><small>${esc(u.role)}</small></p><button class="opt" data-act="logout">Log out</button></div>`, true)
    : postJobButton + '<button data-act="auth" data-mode="login">Log in</button><button class="signup" data-act="auth" data-mode="register">Sign up</button>';
  $('#topnav').innerHTML = left + `<div class="right">${right}</div>`;

  // The phone menu has the same links in a simple list
  $('#nav').innerHTML = (u ? `<p class="who">${esc(u.name)}<small>${esc(u.role)}</small></p>` : '')
    + (!u || u.role === 'client' ? '<button data-go="find">Hire a fundi</button>' : '')
    + (!u || u.role === 'client' ? '<button data-act="postjob">Post a job</button>' : '')
    + (!u || u.role === 'fundi' ? '<button data-act="findjob">Find a job</button>' : '')
    + (u ? messagesButton + `<button data-go="dash">${label}</button><button data-act="logout">Log out</button>`
         : '<button data-act="auth" data-mode="login">Log in</button><button data-act="auth" data-mode="register">Sign up</button>');
}

// Opening and closing the dropdowns in the top menu
function closeDd() {
  document.querySelectorAll('.dd-panel').forEach((p) => { p.hidden = true; });
  document.querySelectorAll('[data-dd]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}
function openDd(key) {
  closeDd();
  $('#dd-' + key).hidden = false;
  document.querySelector(`[data-dd="${key}"]`).setAttribute('aria-expanded', 'true');
}

// What the dropdown choices do
async function dropdownAction(act, id) {
  closeDd();
  if (act === 'signupfundi') {                      // a visitor wants to find jobs: send them to sign up as a fundi
    if (state.user && state.user.role === 'fundi') return show('dash');
    if (state.user) throw new Error('You are logged in with a client account. Log out to create a fundi account.');
    show('auth'); setAuthMode('register');
    document.querySelector('input[name=role][value=fundi]').checked = true;
    return setRegStep(2);
  }
  if (act === 'findjob') {
    if (state.user && state.user.role === 'fundi') { state.tab = 'board'; return show('dash'); }
    return dropdownAction('signupfundi');
  }
  if (act === 'jobcat' || act === 'jobloc') {       // a fundi filters the job board
    state.tab = 'board';
    state.boardFilter = act === 'jobcat' ? { category: id, location: '' } : { category: '', location: $('#dd-jloc').value };
    return show('dash');
  }
  // Hire a fundi: fill in the search boxes on the home page, then search
  if (act === 'hirecat') { $('#cat').value = id; $('#skl').value = ''; }
  if (act === 'hireloc') $('#loc').value = $('#dd-loc').value;
  if (act === 'hireskill') $('#skl').value = $('#dd-skill').value;
show('search');
  await runSearch();
  if ($('#results').scrollIntoView) $('#results').scrollIntoView({ behavior: 'smooth' });
}

// Opens or closes the hamburger menu
function setMenu(open) {
  $('#nav').hidden = !open;
  $('#menubtn').setAttribute('aria-expanded', String(open));
  $('#menubtn').setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { setMenu(false); closeDd(); openBot(false); }
  // Cards that act like buttons (the service cards) also work with Enter and the space bar
  const t = e.target;
  if ((e.key === 'Enter' || e.key === ' ') && t && t.getAttribute && t.getAttribute('role') === 'button' && t.dataset.act) { e.preventDefault(); t.click(); }
  // Pressing Enter in a dropdown box searches, like pressing its Search button
  if (e.key === 'Enter' && e.target && e.target.dataset && e.target.dataset.enter) dropdownAction(e.target.dataset.enter).catch((err) => showMessage(visibleMessage(), err.message, false));
});

// ---------- Screens ----------
// Shows one screen ("find", "auth", "dash" or "profile") and hides the others
function show(view) {
  document.querySelectorAll('main > section').forEach((s) => (s.hidden = s.id !== 'view-' + view));
  if (view === 'dash') renderDash();
  if (view === 'auth') setAuthMode('login');
  if (view !== 'messages') stopChatPolling();
  if (view === 'how') setAudience('clients');
  window.scrollTo(0, 0);
}

// ---------- Find a fundi ----------
// A small photo of the fundi's work, if they have added any
const thumb = (f) => (f.cover ? `<img class="thumb" src="/api/portfolio/${esc(f.cover)}/image" alt="Work by ${esc(f.name)}" loading="lazy">` : '');

const fundiRow = (f) => `<div class="item">
  <div class="withthumb">${thumb(f)}
    <div>
      <div class="fundi-heading">
        ${avatar(f.userId || f.fundiId, f.name, f.hasPhoto, 'fundi-avatar')}
        <h3>${esc(f.name)}</h3>
      </div>
      <p><b>${esc(money(f.rate))}</b> - ${esc(f.location || 'Area not given')}${f.experienceYears != null ? ' - ' + f.experienceYears + ' years of experience' : ''}</p>
      <div>${f.services.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</div>
      <p>${f.rating ? `Rated ${f.rating} from ${plural(f.reviewCount, 'review')}` : 'No reviews yet'}${f.workCount ? ' - ' + plural(f.workCount, 'photo') + ' of past work' : ''}</p>
      <p>${esc(f.reasons.join('. '))}</p>
    </div>
  </div>
  <div class="score"><b>${f.score}</b>match score
    <div class="bar"><i style="width:${f.score}%"></i></div>
    <button class="small" data-act="profile" data-id="${esc(f.fundiId)}">View profile</button>
  </div>
</div>`;

async function runSearch() {
  try {
    // Logged-in clients get a ranking that also uses their description; visitors get a simpler list
    const isClient = state.user && state.user.role === 'client';
    const fields = { categoryId: $('#cat').value, location: $('#loc').value, skill: $('#skl').value };
    const list = isClient
      ? await api('/recommend', { method: 'POST', body: { ...fields, description: $('#desc').value, keywords: state.kw } })
      : await api(`/fundis?category=${encodeURIComponent(fields.categoryId)}&location=${encodeURIComponent(fields.location)}&skill=${encodeURIComponent(fields.skill)}`);
    $('#results').innerHTML = list.length
      ? list.map(fundiRow).join('')
      : '<p class="empty">No fundis match yet. Try another service, area or skill.</p>';
    showMessage($('#aimsg'), '', true);
    if ($('#results').scrollIntoView) $('#results').scrollIntoView({ behavior: 'smooth' });   // bring the results into view
  } catch (err) { showMessage($('#aimsg'), err.message, false); }
}
$('#search').onclick = runSearch;

// Asks the AI which service the description needs, then fills in the Service box. The client can change it.
async function suggestService(text, selectEl, msgEl) {
  if (!state.user || state.user.role !== 'client') return showMessage(msgEl, 'Log in as a client to get a service suggestion.', false);
  try {
    showMessage(msgEl, 'Reading your description...', true);
    const r = await api('/ai/interpret', { method: 'POST', body: { description: text } });
    state.kw = r.keywords || [];
    if (r.categoryId) selectEl.value = r.categoryId;
    const note = r.note ? ' ' + r.note : '';
    showMessage(msgEl, r.categoryId
      ? `Suggested service: ${r.category}. ${r.summary || ''} Please check it and change it if it is wrong.${note}`
      : (r.clarification || 'Please choose a service yourself.') + note, !!r.categoryId);
  } catch (err) { showMessage(msgEl, err.message, false); }
}
$('#suggest').onclick = () => suggestService($('#desc').value, $('#cat'), $('#aimsg'));

// ---------- A fundi's public profile page ----------

async function showProfile(id) {
  const from = currentView();
  const f = await api('/fundis/' + id);

  const tags = (list) => (
    list.length
      ? list.map((s) => `<span class="tag">${esc(s)}</span>`).join('')
      : '<p>Nothing added yet.</p>'
  );

  const gallery = f.portfolio.length
    ? `<div class="gallery">${f.portfolio.map((w) => `<figure><img src="/api/portfolio/${esc(w.id)}/image" alt="${esc(w.caption || 'Work by ' + f.name)}" loading="lazy"><figcaption>${esc(w.caption)}${w.price != null ? ` <b>KES ${Number(w.price).toLocaleString()}</b>` : ''}</figcaption></figure>`).join('')}</div>`
    : '<p class="empty">No photos of past work yet.</p>';

  $('#view-profile').innerHTML = `
    <button class="ghost small" data-go="${from === 'profile' ? 'find' : from}">Back</button>

    <div class="public-profile-heading">
      ${avatar(f.fundiId, f.name, f.hasPhoto, 'public-profile-avatar')}
      <h1>${esc(f.name)}</h1>
    </div>

    <p><b>${esc(money(f.rate))}</b> - ${esc(f.location || 'Area not given')} - ${esc(availabilityText[f.availability])}</p>
    <p>${f.rating ? `Rated ${f.rating} from ${plural(f.reviewCount, 'review')}` : 'No reviews yet'}${f.experienceYears != null ? ' - ' + f.experienceYears + ' years of experience' : ''}</p>

    <h2>Services</h2>${tags(f.services)}
    <h2>Skills</h2>${tags(f.skills)}
    <h2>About</h2><p>${esc(f.description || 'This fundi has not written a description yet.')}</p>
    <h2>Work done</h2>${gallery}
    <h2>Reviews</h2>
    ${f.reviews.length ? f.reviews.map((r) => `<div class="item"><div><h3>${esc(r.rating)} out of 5</h3><p>${esc(r.comment || '')}</p><p>${esc(r.client)}</p></div></div>`).join('') : '<p class="empty">No reviews yet.</p>'}`;

  show('profile');
}


// ---------- Dashboards ----------
async function renderDash() {
  const u = state.user, el = $('#view-dash');
  if (!u) return show('auth');
  try {
    if (!state.cats.length) state.cats = await api('/categories');
    if (u.role === 'client') return await renderClientDash(el);
    if (u.role === 'fundi') return await renderFundiDash(el);
    return await renderAdminDash(el);
  } catch (err) { el.innerHTML = `<p class="msg err">${esc(err.message)}</p>`; }
}

// ===== CLIENT =====
const clientJobRow = (j) => `<div class="item">
  <div>
    <h3>${esc(j.category)} ${statusTag(j.status)}</h3>
    <p>${esc(j.location || '')} - ${day(j.createdAt)}</p>
    <p>${esc(j.description)}</p>
    ${j.hired ? `<p>Hired: <b>${esc(j.hired)}</b></p>` : ''}
  </div>
  <div class="score"><b>${j.offerCount}</b>${j.offerCount === 1 ? 'offer' : 'offers'}
    <div style="margin-top:.6rem"><button class="small" data-act="job" data-id="${esc(j.id)}">${j.status === 'open' ? 'View offers' : 'View details'}</button></div>
  </div>
</div>`;

async function renderClientDash(el) {
  const jobs = await api('/jobs/mine');
 el.innerHTML = `<h1>My jobs</h1>
    ${photoPanel()}
    <p id="dmsg" class="msg" role="status"></p>
    <h2>Post a job</h2>
    <form id="postjob">
      <label for="jd">What do you need done?</label>
      <textarea id="jd" rows="3" maxlength="1000" required placeholder="My bedroom socket sparks"></textarea>
      <div class="actions" style="margin-top:.75rem"><button type="button" class="ghost small" id="jsuggest">Suggest a service</button></div>
      <div class="row">
        <div><label for="jc">Service</label>
          <select id="jc" required><option value="">Choose a service</option>${state.cats.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>
        <div><label for="jl">Your area</label><input id="jl" maxlength="80" placeholder="Nairobi" required></div>
      </div>
      <label for="jp">Your phone number (shared only with the fundi you hire)</label>
      <input id="jp" type="tel" maxlength="20" required>
      <button>Post job</button>
    </form>
    <h2 style="margin-top:2rem">Your jobs</h2>
    ${jobs.length ? jobs.map(clientJobRow).join('') : '<p class="empty">You have not posted a job yet.</p>'}`;

  $('#jsuggest').onclick = () => suggestService($('#jd').value, $('#jc'), $('#dmsg'));
  if (state.prefill) {                                   // text typed on the home page
    $('#jd').value = state.prefill.description || '';
    $('#jc').value = state.prefill.categoryId || '';
    $('#jl').value = state.prefill.location || '';
    state.prefill = null;
    if ($('#postjob').scrollIntoView) $('#postjob').scrollIntoView({ behavior: 'smooth' });
  }
  $('#postjob').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/jobs', { method: 'POST', body: { description: $('#jd').value, categoryId: $('#jc').value, location: $('#jl').value, phone: $('#jp').value, keywords: state.kw } });
      state.kw = [];
      await renderDash();
      showMessage($('#dmsg'), 'Job posted. Fundis who offer this service can now send you offers.', true);
    } catch (err) { showMessage($('#dmsg'), err.message, false); }
  };
}

// One offer on a job, as the client sees it
const offerRow = (o, job) => {
  const f = o.fundi;
  return `<div class="item">
    <div>
      <h3>${esc(f.name)} ${statusTag(o.status)}</h3>
      <p><b>${esc(money(o.price))}</b> - ${esc(f.location || 'Area not given')} - ${esc(availabilityText[f.availability])}</p>
      <p>${f.rating ? `Rated ${f.rating} from ${plural(f.reviewCount, 'review')}` : 'No reviews yet'}</p>
      ${o.message ? `<p>"${esc(o.message)}"</p>` : ''}
      <p>${esc(f.reasons.join('. '))}</p>
      ${o.status === 'accepted' ? `<p><b>Phone: ${esc(o.phone || 'not provided')}</b></p>` : ''}
    </div>
    <div class="score"><b>${f.score}</b>match score
      <div class="bar"><i style="width:${f.score}%"></i></div>
      <button class="ghost small" data-act="profile" data-id="${esc(f.fundiId)}">View profile</button>
      <div style="margin-top:.6rem"><button class="small ghost" data-act="chat" data-job="${esc(job.id)}" data-id="${esc(f.fundiId)}">Message</button></div>
      ${job.status === 'open' && o.status === 'pending' ? `<div style="margin-top:.6rem"><button class="small" data-act="accept" data-id="${esc(o.offerId)}" data-job="${esc(job.id)}">Accept offer</button></div>` : ''}
    </div>
  </div>`;
};

// A fundi the system recommends for this job
const recommendedRow = (f, job) => `<div class="item">
  <div>
    <h3>${esc(f.name)} ${f.invited ? '<span class="tag accepted">invited</span>' : ''}</h3>
    <p><b>${esc(money(f.rate))}</b> - ${esc(f.location || 'Area not given')} - ${esc(availabilityText[f.availability])}</p>
    <p>${f.rating ? `Rated ${f.rating} from ${plural(f.reviewCount, 'review')}` : 'No reviews yet'}</p>
    <p>${esc(f.reasons.join('. '))}</p>
  </div>
  <div class="score"><b>${f.score}</b>match score
    <div class="bar"><i style="width:${f.score}%"></i></div>
    <button class="ghost small" data-act="profile" data-id="${esc(f.fundiId)}">View profile</button>
    ${f.invited ? '' : `<div style="margin-top:.6rem"><button class="small" data-act="invite" data-id="${esc(f.fundiId)}" data-job="${esc(job.id)}">Invite to offer</button></div>`}
  </div>
</div>`;

const recommendedSection = (j) => `<h2 style="margin-top:2rem">Recommended for this job</h2>
  <p>The system ranked fundis who offer this service by skills, area, availability and ratings. Invite the ones you like, and they will see your job first.</p>
  ${j.recommended.length ? j.recommended.map((f) => recommendedRow(f, j)).join('') : '<p class="empty">No other fundis match this job yet.</p>'}`;

async function showJob(id) {
  const j = await api('/jobs/' + id);
  $('#view-dash').innerHTML = `<button class="ghost small" data-act="dash">Back to my jobs</button>
    <h1>${esc(j.category)}</h1>
    <p id="dmsg" class="msg" role="status"></p>
    <p>${statusTag(j.status)} ${esc(j.location || '')}</p>
    <p>${esc(j.description)}</p>
    ${j.status === 'open' ? `<button class="ghost small" data-act="cancel" data-id="${esc(j.id)}">Cancel this job</button>` : ''}
    ${j.status === 'completed' ? (j.reviewed ? '<p><b>Thank you. You have reviewed this job.</b></p>' : `<h2>How did it go?</h2>
      <div class="inlineform"><select id="rr" aria-label="Rating"><option value="5">5 - Excellent</option><option value="4">4 - Good</option><option value="3">3 - Fair</option><option value="2">2 - Poor</option><option value="1">1 - Very poor</option></select>
      <input id="rc" maxlength="500" placeholder="Comment (optional)" aria-label="Comment">
      <button class="small" data-act="review" data-id="${esc(j.id)}">Send review</button></div>`) : ''}
    <h2 style="margin-top:1.5rem">Offers (best match first)</h2>
    ${j.offers.length ? j.offers.map((o) => offerRow(o, j)).join('') : '<p class="empty">No offers yet. Fundis who offer this service can see your job.</p>'}
    ${j.status === 'open' ? recommendedSection(j) : ''}`;
}

// ===== ADMINISTRATOR =====
const userRow = (u) => `<div class="item">
  <div><h3>${esc(u.name)} <span class="tag">${esc(u.role)}</span></h3><p>${esc(u.email)} - joined ${day(u.createdAt)}</p></div>
  <div class="score">${u.role !== 'admin' ? `<button class="small ghost" data-act="deluser" data-id="${esc(u.id)}">Remove user</button>` : ''}</div>
</div>`;

async function renderAdminDash(el) {
  const [s, users] = await Promise.all([
    api('/admin/stats'),
    api('/admin/users')
  ]);

  el.innerHTML = `
    <div class="admin-dashboard">
      <h1>Administration</h1>
      <p class="admin-intro">Manage users and monitor Ujuzi Connect activity.</p>

      <p id="dmsg" class="msg" role="status"></p>

      <h2>Platform summary</h2>

      <div class="admin-stats">
        <div class="admin-stat">
          <span>Clients</span>
          <strong>${s.clients}</strong>
        </div>
        <div class="admin-stat">
          <span>Fundis</span>
          <strong>${s.fundis}</strong>
        </div>
        <div class="admin-stat">
          <span>Total jobs</span>
          <strong>${s.jobs.total}</strong>
        </div>
        <div class="admin-stat">
          <span>Open jobs</span>
          <strong>${s.jobs.open}</strong>
        </div>
        <div class="admin-stat">
          <span>In progress</span>
          <strong>${s.jobs.assigned}</strong>
        </div>
        <div class="admin-stat">
          <span>Completed jobs</span>
          <strong>${s.jobs.completed}</strong>
        </div>
        <div class="admin-stat">
          <span>Cancelled jobs</span>
          <strong>${s.jobs.cancelled}</strong>
        </div>
        <div class="admin-stat">
          <span>Offers</span>
          <strong>${s.offers}</strong>
        </div>
        <div class="admin-stat">
          <span>Reviews</span>
          <strong>${s.reviews}</strong>
        </div>
      </div>

      <h2 class="admin-users-heading">Users</h2>

      <div class="admin-users">
        ${users.length
          ? users.map(userRow).join('')
          : '<p class="empty">No users found.</p>'}
      </div>
    </div>
  `;
}


// ===== FUNDI =====
const tabsBar = () => `<div class="actions" style="margin:0 0 1.5rem">${[['profile', 'My profile'], ['work', 'My work'], ['board', 'Job board'], ['offers', 'My offers']]
  .map(([k, l]) => `<button class="small ${state.tab === k ? '' : 'ghost'}" data-act="tab" data-tab="${k}">${l}</button>`).join('')}</div>`;

async function renderFundiDash(el) {
  if (state.tab === 'board') return renderBoard(el);
  if (state.tab === 'offers') return renderMyOffers(el);
  if (state.tab === 'work') return renderMyWork(el);
  return renderProfileForm(el);
}

async function renderProfileForm(el) {
  const p = await api('/profile');
  const mine = new Set((p.serviceCategories || []).map(String));
  const option = (value, label, current) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;

 el.innerHTML = `${tabsBar()}<h1>My profile</h1>
    ${photoPanel()}
    <p>Clients see this information. Your phone number stays private until a client hires you.</p>
    <form id="profile">
      <label>Services you offer</label>
      <div class="checks">${state.cats.map((c) => `<label class="inline"><input type="checkbox" value="${esc(c.id)}" ${mine.has(String(c.id)) ? 'checked' : ''}>${esc(c.name)}</label>`).join('')}</div>
      <label for="ps">Skills (separate with commas)</label>
      <input id="ps" value="${esc((p.skills || []).join(', '))}">
      <div class="row">
        <div><label for="pl">Area you work in</label><input id="pl" maxlength="80" value="${esc(p.location)}"></div>
        <div><label for="py">Years of experience</label><input id="py" type="number" min="0" max="60" value="${esc(p.experienceYears)}"></div>
      </div>
      <div class="row">
        <div><label for="pm">Your price (KES)</label><input id="pm" type="number" min="0" max="1000000" value="${esc(p.rate && p.rate.amount)}"></div>
        <div><label for="pu">Price is</label><select id="pu">${['per job', 'per hour', 'per day'].map((x) => option(x, x, p.rate && p.rate.unit)).join('')}</select></div>
      </div>
      <label for="pp">Phone number (private)</label>
      <input id="pp" type="tel" maxlength="20" value="${esc(p.phone)}">
      <label for="pa">Availability</label>
      <select id="pa">${option('available', 'Available', p.availability)}${option('busy', 'Busy', p.availability)}${option('unspecified', 'Not stated', p.availability)}</select>
      <label for="pd">About your work</label>
      <textarea id="pd" rows="3" maxlength="600">${esc(p.description)}</textarea>
      <button>Save profile</button>
    </form>
    <p id="dmsg" class="msg" role="status"></p>
    <button class="ghost small" data-act="myprofile">See how clients view my profile</button>`;

  $('#profile').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/profile', { method: 'PUT', body: {
        serviceCategories: [...document.querySelectorAll('#profile .checks input:checked')].map((i) => i.value),
        skills: $('#ps').value.split(','),
        location: $('#pl').value,
        experienceYears: $('#py').value,
        rateAmount: $('#pm').value,
        rateUnit: $('#pu').value,
        phone: $('#pp').value,
        availability: $('#pa').value,
        description: $('#pd').value,
      } });
      showMessage($('#dmsg'), 'Profile saved.', true);
    } catch (err) { showMessage($('#dmsg'), err.message, false); }
  };
}

const boardRow = (j) => `<div class="item">
  <div>
    <h3>${esc(j.category)} ${j.invited ? '<span class="tag accepted">invited you</span>' : ''} ${j.myOffer ? statusTag(j.myOffer.status) : ''}</h3>
    <p>${esc(j.client)} - ${esc(j.location || 'Area not given')} - ${day(j.createdAt)} - ${plural(j.offerCount, 'offer')} so far</p>
    <p>${esc(j.description)}</p>
    ${j.myOffer
      ? `<p>Your offer: <b>${esc(money(j.myOffer.price))}</b></p>`
      : `<div class="inlineform"><input id="om-${esc(j.id)}" maxlength="300" placeholder="Short message to the client (optional)" aria-label="Message"><button class="small" data-act="offer" data-id="${esc(j.id)}">Offer my price</button></div>`}
  </div>
</div>`;

async function renderBoard(el) {
  const f = state.boardFilter;
  const b = await api(`/board?category=${encodeURIComponent(f.category)}&location=${encodeURIComponent(f.location)}`);
  const filtered = f.category || f.location;
  el.innerHTML = `${tabsBar()}<h1>Job board</h1>
    <p>Open jobs for the services on your profile. When you send an offer, it carries the price from your profile.</p>
    <form id="boardfilter">
      <div class="row">
        <div><label for="bf-c">Service</label>
          <select id="bf-c"><option value="">All my services</option>${state.cats.map((c) => `<option value="${esc(c.id)}" ${f.category === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div><label for="bf-l">Area</label><input id="bf-l" maxlength="80" placeholder="Nairobi" value="${esc(f.location)}"></div>
      </div>
      <button class="small">Apply filter</button>
    </form>
    <p id="dmsg" class="msg" role="status"></p>
    ${!b.hasServices ? '<p class="empty">Tick the services you offer in My profile to see matching jobs.</p>'
      : b.jobs.length ? b.jobs.map(boardRow).join('')
      : `<p class="empty">${filtered ? 'No open jobs match this filter. Jobs are shown only for the services on your profile.' : 'No open jobs for your services right now. Check again soon.'}</p>`}`;
  $('#boardfilter').onsubmit = async (e) => {
    e.preventDefault();
    state.boardFilter = { category: $('#bf-c').value, location: $('#bf-l').value };
    await renderDash();
  };
}

const myOfferRow = (o) => `<div class="item">
  <div>
    <h3>${esc(o.job.category)} ${statusTag(o.status)}</h3>
    <p>${esc(o.job.client)} - ${esc(o.job.location || '')} - Your price: <b>${esc(money(o.price))}</b></p>
    <p>${esc(o.job.description)}</p>
    ${o.status === 'accepted' ? `<p><b>Client phone: ${esc(o.job.clientPhone || 'not provided')}</b></p>` : ''}
  </div>
  <div class="score">
    <div style="margin-bottom:.6rem"><button class="small ghost" data-act="chat" data-job="${esc(o.job.id)}" data-id="${esc(state.user.id)}">Message client</button></div>
    ${o.status === 'accepted' && o.job.status === 'assigned' ? `<button class="small" data-act="complete" data-id="${esc(o.job.id)}">Mark completed</button>` : ''}
    ${o.job.status === 'completed' && o.status === 'accepted' ? statusTag('completed') : ''}
  </div>
</div>`;

async function renderMyOffers(el) {
  const offers = await api('/offers/mine');
  el.innerHTML = `${tabsBar()}<h1>My offers</h1>
    <p id="dmsg" class="msg" role="status"></p>
    ${offers.length ? offers.map(myOfferRow).join('') : '<p class="empty">You have not sent any offers yet. Open the Job board to find work.</p>'}`;
}

// Shrinks a photo in the browser before it is sent, so uploads are small and fast
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Choose a JPG, PNG or WebP photo.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';                                  // a white background for transparent PNGs
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That photo could not be read. Try another one.')); };
    img.src = url;
  });
}

// The fundi's "My work" tab: add and delete photos of finished jobs
async function renderMyWork(el) {
  const items = await api('/portfolio/mine');
  el.innerHTML = `${tabsBar()}<h1>My work</h1>
    <p>Add photos of jobs you have finished. Clients see them on your profile and in search results. You can show up to 12.</p>
    <form id="workform">
      <label for="wf">Photo</label>
      <input id="wf" type="file" accept="image/jpeg,image/png,image/webp" required>
      <label for="wc">What is it? (for example: oak bed, 6 by 6)</label>
      <input id="wc" maxlength="120">
      <label for="wp">Price for this work, in KES (optional)</label>
      <input id="wp" type="number" min="0" max="1000000">
      <button>Upload photo</button>
    </form>
    <p id="dmsg" class="msg" role="status"></p>
    ${items.length ? `<div class="gallery">${items.map((w) => `<figure><img src="/api/portfolio/${esc(w.id)}/image" alt="${esc(w.caption || 'My work')}" loading="lazy">
        <figcaption>${esc(w.caption)}${w.price != null ? ` <b>KES ${Number(w.price).toLocaleString()}</b>` : ''}<br>
        <button class="small ghost" data-act="delwork" data-id="${esc(w.id)}">Delete</button></figcaption></figure>`).join('')}</div>`
      : '<p class="empty">You have not added any photos yet.</p>'}`;

  $('#workform').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const image = await shrinkImage($('#wf').files[0]);
      await api('/portfolio', { method: 'POST', body: { image, caption: $('#wc').value, price: $('#wp').value } });
      await renderDash();
      showMessage($('#dmsg'), 'Photo added. Clients can now see it on your profile.', true);
    } catch (err) { showMessage($('#dmsg'), err.message, false); }
  };
}

// A service card on the home page: finds the matching service, then searches for fundis who offer it
async function searchService(key) {
  const cat = state.cats.find((c) => c.name.toLowerCase().startsWith(key));
  if (!cat) throw new Error('The services are still loading. Please try again in a moment.');
  return dropdownAction('hirecat', cat.id);
}

// ---------- Home page: service tiles, and the footer "Our network" ----------
const icons = {
  plumbing: '<path d="M12 3s6 6.2 6 10.5A6 6 0 0 1 6 13.5C6 9.2 12 3 12 3z"/>',
  electrical: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  carpentry: '<path d="M13.5 3.5l7 7-3 3-7-7z"/><path d="M10 8L3 15l3 3 7-7"/>',
  masonry: '<path d="M3 6h18v4H3zM3 14h18v4H3z"/><path d="M9 6v4M15 14v4"/>',
  painting: '<rect x="4" y="3" width="14" height="6" rx="1"/><path d="M18 6h2v5h-8v3"/><rect x="10" y="14" width="4" height="7" rx="1"/>',
  welding: '<path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  appliance: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
  default: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7 6.3 21l6.300-6.300a4 4 0 0 0 5.100-5.400L15 12l-3-3z"/>',
};
const iconFor = (name) => icons[Object.keys(icons).find((k) => name.toLowerCase().startsWith(k)) || 'default'];

// One tile for each service. Clicking a tile searches for fundis in that service.
function renderTiles() {
  if (!document.querySelector('#tiles')) return;       // this page has no tile area, so there is nothing to draw
  $('#tiles').innerHTML = state.cats.map((c) => `<button class="tile" data-act="hirecat" data-id="${esc(c.id)}">
    <span class="tile-ico"><svg viewBox="0 0 24 24" aria-hidden="true">${iconFor(c.name)}</svg></span><b>${esc(c.name)}</b></button>`).join('');
}


function renderFooterNetwork() {
  if (!document.querySelector('#footnet')) return;

  const s = state.stats;

  const facts = [];
  if (s && s.fundis) facts.push(`${s.fundis} fundis`);
  if (s && s.completed) facts.push(`${s.completed} jobs`);
  if (s && s.reviews) facts.push(`${s.reviews} reviews`);

  const services = ['Plumbing', 'Carpentry', 'Electrical', 'More'];

  $('#footnet').innerHTML = `
    <p class="stat">${facts.length ? facts.map(esc).join(' · ') : 'A growing network of skilled fundis'}</p>
    <p class="footer-services">${services.map(esc).join(' · ')}</p>
  `;
}


// ---------- Help assistant ----------
const botQuestions = ['How do I post a job?', 'How do I get jobs as a fundi?', 'How do I pay?', 'Is my phone number safe?'];
const okGo = ['about', 'how', 'find'], okAct = ['postjob', 'signupfundi', 'audience', 'inbox', 'auth'];

// A button under an answer, for example "How it works". Only known destinations are allowed.
function botAction(a) {
  if (!a) return '';
  let attrs = '';
  if (a.go && okGo.includes(a.go)) attrs = `data-go="${esc(a.go)}"${a.scroll ? ` data-scroll="${esc(a.scroll)}"` : ''}`;
  else if (a.act && okAct.includes(a.act)) attrs = `data-act="${esc(a.act)}"${a.who ? ` data-who="${esc(a.who)}"` : ''}${a.mode ? ` data-mode="${esc(a.mode)}"` : ''}`;
  return attrs ? `<div style="margin-top:.4rem"><button class="small ghost" ${attrs}>${esc(a.label)}</button></div>` : '';
}

function renderBot() {
  $('#botlog').innerHTML = state.bot.map((m) => `<div class="mrow ${m.who === 'user' ? 'mine' : ''}"><div class="bubble">${esc(m.text)}${m.who === 'bot' ? botAction(m.action) : ''}</div></div>`).join('');
  $('#botlog').scrollTop = $('#botlog').scrollHeight;
  // suggested questions are shown until the person has asked something
  $('#botchips').innerHTML = state.bot.some((m) => m.who === 'user') ? ''
    : botQuestions.map((q) => `<button type="button" class="chip" data-chip="${esc(q)}">${esc(q)}</button>`).join('');
}

function openBot(open) {
  $('#bot').hidden = !open;
  $('#botbtn').setAttribute('aria-expanded', String(open));
  $('#botbtn').setAttribute('aria-label', open ? 'Close the assistant' : 'Ask Ujuzi: open the assistant');
  if (open && !state.bot.length) state.bot.push({ who: 'bot', text: 'Hi! I can answer questions about using Ujuzi Connect. Try one of these, or type your own question.' });
  if (open) { renderBot(); if ($('#botin').focus) $('#botin').focus(); }
}

async function askBot(text) {
  state.bot.push({ who: 'user', text });
  const thinking = { who: 'bot', text: 'Thinking...' };
  state.bot.push(thinking);
  renderBot();
  try {
    const r = await api('/assistant', { method: 'POST', body: { message: text } });
    thinking.text = r.answer;
    thinking.action = r.action;
  } catch (err) { thinking.text = 'Sorry, I could not answer that right now. ' + err.message; }
  renderBot();
}
$('#botform').onsubmit = (e) => {
  e.preventDefault();
  const text = $('#botin').value.trim();
  if (!text) return;
  $('#botin').value = '';
  askBot(text);
};

// ---------- How it works: clients or fundis ----------
// Shows the clients' part or the fundis' part, never both at once
function setAudience(who) {
  $('#for-clients').hidden = who !== 'clients';
  $('#for-fundis').hidden = who !== 'fundis';
  document.querySelectorAll('#audience-tabs button').forEach((b) => b.classList.toggle('ghost', b.dataset.who !== who));
}

// ---------- Messages ----------
let chatTimer = null;
function stopChatPolling() { if (chatTimer) { clearInterval(chatTimer); chatTimer = null; } state.chat = null; }
const when = (d) => new Date(d).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Checks for new messages and updates the badge in the menu
async function refreshUnread() {
  if (!state.user || state.user.role === 'admin') return;
  try {
    const r = await api('/messages/unread-count');
    if (r.count !== state.unread) { state.unread = r.count; renderNav(); }
  } catch { /* the badge simply stays as it was */ }
}

// The inbox: all my conversations
async function showInbox() {
  stopChatPolling();
  const list = await api('/messages/conversations');
  $('#view-messages').innerHTML = `<h1>Messages</h1>
    <p id="mmsg" class="msg" role="status"></p>
    ${list.length ? list.map((c) => `<div class="item">
      <div>
        <h3>${esc(c.with)} ${c.unread ? `<span class="tag pending">${c.unread} new</span>` : ''}</h3>
        <p>${esc(c.category || '')} - ${esc(c.job)}</p>
        <p>${c.lastMine ? 'You: ' : ''}${esc(c.last)} <small>${when(c.lastAt)}</small></p>
      </div>
      <div class="score"><button class="small" data-act="chat" data-job="${esc(c.jobId)}" data-id="${esc(c.fundiId)}">Open</button></div>
    </div>`).join('') : '<p class="empty">No messages yet. When a fundi sends you an offer, or you send an offer on a job, you can start a conversation from that offer.</p>'}`;
  show('messages');
  refreshUnread();
}

// The speech bubbles of one conversation
const bubbles = (messages) => messages.length
  ? messages.map((m) => `<div class="mrow ${m.mine ? 'mine' : ''}"><div class="bubble">${esc(m.text)}<small>${when(m.createdAt)}</small></div></div>`).join('')
  : '<p class="note">No messages yet. Say hello and ask your question.</p>';

// Opens one conversation and keeps it fresh while it is open
async function openChat(jobId, fundiId) {
  stopChatPolling();
  state.chat = { jobId, fundiId };
  await loadThread(true);
  show('messages');
  chatTimer = setInterval(() => loadThread(false).catch(() => {}), 8000);
}

async function loadThread(scrollDown) {
  if (!state.chat) return;
  const { jobId, fundiId } = state.chat;
  const t = await api(`/messages/thread?jobId=${encodeURIComponent(jobId)}&fundiId=${encodeURIComponent(fundiId)}`);
  if (!$('#chatlog')) {                                      // first time: draw the whole screen
    $('#view-messages').innerHTML = `<button class="ghost small" data-act="inbox">Back to messages</button>
      <h1>${esc(t.with)}</h1>
      <p class="note">${esc(t.category || '')}: ${esc(t.job)}</p>
      <p id="mmsg" class="msg" role="status"></p>
      <div class="chatlog" id="chatlog" aria-live="polite"></div>
      ${t.canSend ? `<form class="chatform" id="chatform">
        <textarea id="chattext" rows="2" maxlength="1000" placeholder="Write a message" aria-label="Message" required></textarea>
        <button>Send</button></form>
        <p class="note">Never send money to someone you have not met, and agree the price before work starts. Press Enter to send, Shift+Enter for a new line.</p>`
      : '<p class="note">This conversation is closed. You can read it, but you cannot send new messages.</p>'}`;
    if ($('#chatform')) {
      const send = async () => {
        const box = $('#chattext');
        if (!box.value.trim()) return;
        try {
          await api('/messages', { method: 'POST', body: { jobId, fundiId, text: box.value } });
          box.value = '';
          await loadThread(true);
        } catch (err) { showMessage($('#mmsg'), err.message, false); }
      };
      $('#chatform').onsubmit = (e) => { e.preventDefault(); send(); };
      $('#chattext').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    }
    scrollDown = true;
  }
  const log = $('#chatlog');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;   // do not jump while someone is reading older messages
  log.innerHTML = bubbles(t.messages);
  if (scrollDown || atBottom) log.scrollTop = log.scrollHeight;
  refreshUnread();
}

// ---------- Post a job button ----------
// Keeps what was typed on the home page, then takes a client to the form (or asks a visitor to sign up first)
async function startPostJob() {
  state.prefill = { description: $('#desc').value, categoryId: $('#cat').value, location: $('#loc').value };
  if (state.user && state.user.role === 'client') return show('dash');
  if (state.user) throw new Error('Only client accounts can post jobs. Log in with a client account.');
  show('auth'); setAuthMode('register');
  document.querySelector('input[name=role][value=client]').checked = true;
  setRegStep(2);
  showMessage($('#authmsg'), 'Create a free client account to post your job.', true);
}

// ---------- Log in, create an account, forgot password ----------
// Only one of the four forms is visible at a time
function setAuthMode(mode) {
  ['login', 'register', 'forgot', 'reset'].forEach((m) => ($('#' + m).hidden = m !== mode));
  if (mode === 'register') setRegStep(1);
  showMessage($('#authmsg'), '', true);
}
// The create-account form has two steps: choose how you will use the site, then enter your details
function setRegStep(n) {
  $('#reg1').hidden = n !== 1;
  $('#reg2').hidden = n !== 2;
}

// Checks whether a password meets all security requirements
function checkPasswordStrength(password) {
  return {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9\s]/.test(password),
  };
}

// Updates the password checklist while the user types
$('#rp').addEventListener('input', () => {
  const password = $('#rp').value;
  const rules = checkPasswordStrength(password);

  Object.entries(rules).forEach(([rule, passed]) => {
    const item = document.querySelector(`[data-password-rule="${rule}"]`);

    if (!item) return;

    item.classList.toggle('valid', passed);
    item.textContent = `${passed ? '✓' : '○'} ${{
      length: 'At least 8 characters',
      uppercase: 'One uppercase letter (A–Z)',
      lowercase: 'One lowercase letter (a–z)',
      number: 'One number (0–9)',
      special: 'One special character (!@#$%)',
    }[rule]}`;
  });
});

$('#register').onsubmit = async (e) => {
  e.preventDefault();                                   // stops the page from reloading
    const password = $('#rp').value;
  const rules = checkPasswordStrength(password);

  if (!Object.values(rules).every(Boolean)) {
    showMessage($('#authmsg'), 'Please meet all five password requirements.', false);
    return;
  }
  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body: { name: $('#rn').value, email: $('#re').value, password: $('#rp').value, role: $('input[name=role]:checked').value },
    });
    saveSession(data);
    refreshUnread();
    state.tab = 'profile';
    show(data.user.role === 'client' && !state.prefill ? 'find' : 'dash');
  } catch (err) { showMessage($('#authmsg'), err.message, false); }
};

$('#login').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const data = await api('/auth/login', { method: 'POST', body: { email: $('#le').value, password: $('#lp').value } });
    saveSession(data);
    refreshUnread();
    show(data.user.role === 'client' && !state.prefill ? 'find' : 'dash');
  } catch (err) { showMessage($('#authmsg'), err.message, false); }
};

// Forgot password: asks the server to send a reset link
$('#forgot').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const r = await api('/auth/forgot', { method: 'POST', body: { email: $('#fe').value } });
    showMessage($('#authmsg'), r.message, true);
  } catch (err) { showMessage($('#authmsg'), err.message, false); }
};

// New password: the secret token comes from the link in the email
let resetToken = null;
$('#reset').onsubmit = async (e) => {
  e.preventDefault();
  if ($('#np').value !== $('#np2').value) return showMessage($('#authmsg'), 'The two passwords do not match.', false);
  try {
    await api('/auth/reset', { method: 'POST', body: { token: resetToken, password: $('#np').value } });
    resetToken = null;
    setAuthMode('login');
    showMessage($('#authmsg'), 'Your password has been changed. Log in with the new password.', true);
  } catch (err) { showMessage($('#authmsg'), err.message, false); }
};

// ---------- Clicks on buttons ----------
document.addEventListener('click', async (e) => {
  if (e.target.closest('#botbtn')) return openBot($('#bot').hidden);       // the Ask Ujuzi button
  if (e.target.closest('#botclose')) return openBot(false);
  const chip = e.target.closest('[data-chip]');                            // a suggested question
  if (chip) return askBot(chip.dataset.chip);
  if (e.target.closest('#menubtn')) return setMenu($('#nav').hidden);      // the hamburger button on phones
  const ddButton = e.target.closest('[data-dd]');
  if (ddButton) {                                                          // a dropdown in the top menu
    const key = ddButton.dataset.dd, wasOpen = !$('#dd-' + key).hidden;
    closeDd();
    if (!wasOpen) openDd(key);
    return;
  }
  if (e.target.closest('.dd-panel') && !e.target.closest('button')) return; // typing in a box or clicking blank space
  closeDd();
  setMenu(false);                                                          // any other click closes the menus
  const b = e.target.closest('[data-go],[data-act],[data-auth]');
  if (!b) return;
  if (e.target.closest('#bot')) openBot(false);                           // a button inside an answer takes you there, so tuck the chat away
  if (b.dataset.go) {
    show(b.dataset.go);
    const target = b.dataset.scroll && document.getElementById(b.dataset.scroll);   // e.g. the "Safe and secure" part of a page
    if (target) target.scrollIntoView();
    return;
  }
  if (b.dataset.auth) return setAuthMode(b.dataset.auth);   // links such as "Forgot password?"
  const act = b.dataset.act, id = b.dataset.id;
  try {
    if (act === 'logout') { saveSession(null); show('find'); }
    else if (['hirecat', 'hireloc', 'hireskill', 'jobcat', 'jobloc', 'signupfundi', 'findjob'].includes(act)) await dropdownAction(act, id);
    else if (act === 'audience') {
      if (currentView() !== 'how') show('how');            // from another page: open How it works first
      setAudience(b.dataset.who);
      const part = $('#for-' + b.dataset.who);
      if (part.scrollIntoView) part.scrollIntoView();
    }
    else if (act === 'inbox') await showInbox();
else if (act === 'chat') await openChat(b.dataset.job, id);
else if (act === 'service') await searchService(b.dataset.key);
else if (act === 'postjob') await startPostJob();

else if (act === 'delwork') {
  if (!confirm('Delete this photo?')) return;
  await api('/portfolio/' + id, { method: 'DELETE' });
  await renderDash();
  showMessage($('#dmsg'), 'Photo deleted.', true);
}
else if (act === 'uploadphoto') {
  await uploadPhoto();
}
else if (act === 'removephoto') {
  if (!confirm('Remove your profile photo?')) return;
  await removePhoto();
}
    else if (act === 'auth') { show('auth'); setAuthMode(b.dataset.mode); }
    else if (act === 'regnext') setRegStep(2);
    else if (act === 'regback') setRegStep(1);
    else if (act === 'profile') await showProfile(id);
    else if (act === 'myprofile') await showProfile(state.user.id);
    else if (act === 'dash') show('dash');
    else if (act === 'tab') { state.tab = b.dataset.tab; await renderDash(); }
    else if (act === 'job') await showJob(id);
    else if (act === 'accept') {
      await api(`/jobs/${b.dataset.job}/offers/${id}/accept`, { method: 'POST' });
      await showJob(b.dataset.job);
      showMessage($('#dmsg'), 'Offer accepted. The fundi\'s phone number is now shown below.', true);
    } else if (act === 'cancel') { await api(`/jobs/${id}/cancel`, { method: 'POST' }); await renderDash(); }
    else if (act === 'offer') {
      await api(`/jobs/${id}/offers`, { method: 'POST', body: { message: $('#om-' + id).value } });
      await renderDash();
      showMessage($('#dmsg'), 'Offer sent. The client will see it with your price.', true);
    } else if (act === 'invite') {
      await api(`/jobs/${b.dataset.job}/invite/${id}`, { method: 'POST' });
      await showJob(b.dataset.job);
      showMessage($('#dmsg'), 'Invitation sent. The fundi will see your job at the top of their job board.', true);
    } else if (act === 'review') {
      await api('/reviews', { method: 'POST', body: { jobId: id, rating: $('#rr').value, comment: $('#rc').value } });
      await showJob(id);
      showMessage($('#dmsg'), 'Review sent. It now appears on the fundi\'s profile.', true);
    } else if (act === 'deluser') {
      if (!confirm('Remove this user and everything they posted? This cannot be undone.')) return;
      await api('/admin/users/' + id, { method: 'DELETE' });
      await renderDash();
      showMessage($('#dmsg'), 'User removed.', true);
    } else if (act === 'complete') {
      await api(`/jobs/${id}/complete`, { method: 'POST' });
      await renderDash();
      showMessage($('#dmsg'), 'Job marked as completed.', true);
    }
  } catch (err) { showMessage(visibleMessage(), err.message, false); }
});
document.addEventListener('change', async (e) => {
  if (e.target.matches('#pf') && e.target.files.length > 0) {
    await uploadPhoto();
  }
});
document.addEventListener('click', (e) => {
  if (e.target.closest('#photoCamera')) {
    document.getElementById('pf')?.click();
  }
});

// ---------- When the page opens ----------
renderNav();
api('/categories')
  .then((cats) => {
    state.cats = cats;
    renderNav();                       // the menus list the services, so draw them again
    renderTiles();
    renderFooterNetwork();
    $('#cat').insertAdjacentHTML('beforeend', cats.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join(''));
  })
  .catch(() => showMessage($('#aimsg'), 'Could not load the services. Refresh the page.', false));

// Opened from the link in a password reset email: https://.../?reset=TOKEN
const resetParam = new URLSearchParams(location.search).get('reset');
if (resetParam) {
  resetToken = resetParam;
  history.replaceState({}, '', location.pathname);   // removes the secret from the address bar
  show('auth');
  setAuthMode('reset');
}

// Messages: check for new ones when the page opens, then every 30 seconds
refreshUnread();
setInterval(refreshUnread, 30000);

// The footer shows how big the network is
api('/stats').then((s) => { state.stats = s; renderFooterNetwork(); }).catch(() => renderFooterNetwork());