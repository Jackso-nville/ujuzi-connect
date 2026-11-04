// Ujuzi Connect: the browser code.
// Stage 2 does: switching screens, the top menu, sign up, log in, log out and the service dropdown.

// ---------- Small helpers ----------
const $ = (selector) => document.querySelector(selector);

// Makes text safe to put on the page (stops injected code)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Remembers who is logged in (kept in the browser so a refresh does not log you out)
const state = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
};

// Talks to the backend. Every request goes through here.
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

// Shows a message in green (ok) or red (error) inside the element you give it
function showMessage(el, text, ok) {
  el.textContent = text;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
}

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

// Draws the buttons at the top right depending on whether someone is logged in
function renderNav() {
  const u = state.user;
  $('#nav').innerHTML = '<button data-go="find">Find a fundi</button>' + (u
    ? `<button data-go="dash">My page</button><button data-act="logout">Log out (${esc(u.name)})</button>`
    : '<button data-go="auth">Log in or sign up</button>');
}

// ---------- Screens ----------
// Shows one screen ("find", "auth" or "dash") and hides the others
function show(view) {
  document.querySelectorAll('main > section').forEach((s) => (s.hidden = s.id !== 'view-' + view));
  if (view === 'dash') renderDash();
  window.scrollTo(0, 0);
}

// A simple page for after login. The real dashboards are built in the next stages.
function renderDash() {
  const u = state.user;
  if (!u) return show('auth');
  const what = { client: 'post jobs and choose fundis', fundi: 'build your profile and respond to jobs', admin: 'manage users' }[u.role];
  $('#view-dash').innerHTML = `<h1>Welcome, ${esc(u.name)}</h1>
    <p>You are signed in as a <b>${esc(u.role)}</b>. Soon you will be able to ${esc(what)} here.</p>`;
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

// ---------- Buttons on the find page (built in later stages) ----------
$('#suggest').onclick = () => showMessage($('#aimsg'), 'The AI suggestion is coming in a later stage.', true);
$('#search').onclick = () => showMessage($('#aimsg'), 'Searching for fundis is coming in a later stage.', true);

// ---------- Clicks on menu buttons ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go],[data-act]');
  if (!b) return;
  if (b.dataset.go) return show(b.dataset.go);
  if (b.dataset.act === 'logout') { saveSession(null); show('find'); }
});

// ---------- When the page opens ----------
renderNav();
api('/categories')
  .then((cats) => {
    $('#cat').insertAdjacentHTML('beforeend', cats.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join(''));
  })
  .catch(() => showMessage($('#aimsg'), 'Could not load the services. Refresh the page.', false));