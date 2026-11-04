// Ujuzi Connect: the browser code.
// Stage 3 adds: browsing fundis, public fundi profile pages, and the fundi's own profile form with prices.

// ---------- Small helpers ----------
const $ = (selector) => document.querySelector(selector);

// Makes text safe to put on the page (stops injected code)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Remembers who is logged in (kept in the browser so a refresh does not log you out)
const state = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  cats: [],
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
  el.textContent = text;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
}

// Turns a price into text, for example "KES 1,500 per job"
const money = (r) => (r && r.amount != null ? `KES ${Number(r.amount).toLocaleString()} ${r.unit}` : 'Price not set');
const availabilityText = { available: 'Available now', busy: 'Busy at the moment', unspecified: 'Availability not stated' };

// ---------- Login state ----------
function saveSession(data) {
  state.token = data ? data.token : null;
  state.user = data ? data.user : null;
  if (data) {
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
  } else {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }
  renderNav();
}

function renderNav() {
  const u = state.user;
  $('#nav').innerHTML = '<button data-go="find">Find a fundi</button>' + (u
    ? `<button data-go="dash">${u.role === 'fundi' ? 'My profile' : 'My page'}</button><button data-act="logout">Log out (${esc(u.name)})</button>`
    : '<button data-go="auth">Log in or sign up</button>');
}

// ---------- Screens ----------
// Shows one screen ("find", "auth", "dash" or "profile") and hides the others
function show(view) {
  document.querySelectorAll('main > section').forEach((s) => (s.hidden = s.id !== 'view-' + view));
  if (view === 'dash') renderDash();
  window.scrollTo(0, 0);
}

// ---------- Find a fundi ----------
// One row in the list of fundis
const fundiRow = (f) => `<div class="item">
  <div>
    <h3>${esc(f.name)}</h3>
    <p><b>${esc(money(f.rate))}</b> - ${esc(f.location || 'Area not given')}${f.experienceYears != null ? ' - ' + f.experienceYears + ' years of experience' : ''}</p>
    <div>${f.services.map((s) => `<span class="tag">${esc(s)}</span>`).join('')}</div>
    <p>${esc(f.reasons.join('. '))}</p>
  </div>
  <div class="score"><b>${f.score}</b>match score
    <div class="bar"><i style="width:${f.score}%"></i></div>
    <button class="small" data-act="profile" data-id="${esc(f.fundiId)}">View profile</button>
  </div>
</div>`;

$('#search').onclick = async () => {
  try {
    const list = await api(`/fundis?category=${encodeURIComponent($('#cat').value)}&location=${encodeURIComponent($('#loc').value)}`);
    $('#results').innerHTML = list.length
      ? list.map(fundiRow).join('')
      : '<p class="empty">No fundis match yet. Try another service or area.</p>';
    showMessage($('#aimsg'), '', true);
  } catch (err) { showMessage($('#aimsg'), err.message, false); }
};
$('#suggest').onclick = () => showMessage($('#aimsg'), 'The AI suggestion is coming in a later stage.', true);

// ---------- A fundi's public profile page ----------
async function showProfile(id) {
  try {
    const f = await api('/fundis/' + id);
    const tags = (list) => (list.length ? list.map((s) => `<span class="tag">${esc(s)}</span>`).join('') : '<p>Nothing added yet.</p>');
    $('#view-profile').innerHTML = `
      <button class="ghost small" data-go="find">Back to search</button>
      <h1>${esc(f.name)}</h1>
      <p><b>${esc(money(f.rate))}</b> - ${esc(f.location || 'Area not given')} - ${esc(availabilityText[f.availability])}</p>
      <p>${f.rating ? `Rated ${f.rating} from ${f.reviewCount} review${f.reviewCount > 1 ? 's' : ''}` : 'No reviews yet'}${f.experienceYears != null ? ' - ' + f.experienceYears + ' years of experience' : ''}</p>
      <h2>Services</h2>${tags(f.services)}
      <h2>Skills</h2>${tags(f.skills)}
      <h2>About</h2><p>${esc(f.description || 'This fundi has not written a description yet.')}</p>
      <h2>Reviews</h2>
      ${f.reviews.length ? f.reviews.map((r) => `<div class="item"><div><h3>${esc(r.rating)} out of 5</h3><p>${esc(r.comment || '')}</p><p>${esc(r.client)}</p></div></div>`).join('') : '<p class="empty">No reviews yet.</p>'}`;
    show('profile');
  } catch (err) { showMessage($('#aimsg'), err.message, false); }
}

// ---------- Dashboards ----------
async function renderDash() {
  const u = state.user, el = $('#view-dash');
  if (!u) return show('auth');
  try {
    if (u.role === 'fundi') return await renderFundiDash(el);
    const what = { client: 'post jobs and choose fundis', admin: 'manage users' }[u.role];
    el.innerHTML = `<h1>Welcome, ${esc(u.name)}</h1>
      <p>You are signed in as a <b>${esc(u.role)}</b>. Soon you will be able to ${esc(what)} here.</p>`;
  } catch (err) { el.innerHTML = `<p class="msg err">${esc(err.message)}</p>`; }
}

// The fundi's profile form
async function renderFundiDash(el) {
  if (!state.cats.length) state.cats = await api('/categories');
  const p = await api('/profile');
  const mine = new Set((p.serviceCategories || []).map(String));
  const option = (value, label, current) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`;

  el.innerHTML = `<h1>My profile</h1>
    <p>Clients see this information. Your phone number stays private.</p>
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

// ---------- Sign up and log in ----------
$('#register').onsubmit = async (e) => {
  e.preventDefault();                                   // stops the page from reloading
  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body: { name: $('#rn').value, email: $('#re').value, password: $('#rp').value, role: $('input[name=role]:checked').value },
    });
    saveSession(data);
    show(data.user.role === 'client' ? 'find' : 'dash');
  } catch (err) { showMessage($('#authmsg'), err.message, false); }
};

$('#login').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const data = await api('/auth/login', { method: 'POST', body: { email: $('#le').value, password: $('#lp').value } });
    saveSession(data);
    show(data.user.role === 'client' ? 'find' : 'dash');
  } catch (err) { showMessage($('#authmsg'), err.message, false); }
};

// ---------- Clicks on buttons ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go],[data-act]');
  if (!b) return;
  if (b.dataset.go) return show(b.dataset.go);
  if (b.dataset.act === 'logout') { saveSession(null); show('find'); }
  if (b.dataset.act === 'profile') showProfile(b.dataset.id);
  if (b.dataset.act === 'myprofile') showProfile(state.user.id);
});

// ---------- When the page opens ----------
renderNav();
api('/categories')
  .then((cats) => {
    state.cats = cats;
    $('#cat').insertAdjacentHTML('beforeend', cats.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join(''));
  })
  .catch(() => showMessage($('#aimsg'), 'Could not load the services. Refresh the page.', false));