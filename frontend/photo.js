// Profile photos, and what a visitor sees first. Loaded before app.js.
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// A round profile picture, or the person's initials when they have no photo
function avatar(id, name, has, size = '') {
  return has
    ? `<img class="avatar ${size}" src="/api/users/${esc(id)}/photo?v=${state.photoV || 0}" alt="${esc(name)}">`
    : `<span class="avatar ${size}" aria-hidden="true">${esc(initials(name))}</span>`;
}

// Visitors see the explanation page; clients the search page; fundis and admins their dashboard
function startView() { const u = state.user; return !u ? 'home' : u.role === 'client' ? 'find' : 'dash'; }

// A visitor tries something that needs an account
function promptSignup(role, text) {
  show('auth'); setAuthMode('register');
  document.querySelector(`input[name=role][value=${role}]`).checked = true;
  setRegStep(2);
  showMessage($('#authmsg'), text, true);
}


function photoPanel() {
  const u = state.user;
  return `<div class="photopanel">
    <div class="photo-preview photo-edit-wrap">
      ${avatar(u.id, u.name, u.hasPhoto, 'big')}
      <button type="button" class="photo-camera"
  id="photoCamera" aria-label="Change profile photo"
  title="Change profile photo">
  📷
</button>
      <input id="pf" type="file"
        accept="image/jpeg,image/png,image/webp" hidden>
    </div>
    <div class="photo-controls">
      <p>Profile photo</p>
      ${u.hasPhoto ? '<button type="button" class="small ghost" data-act="removephoto">Remove photo</button>' : ''}
      <p id="pmsg" class="note" role="status"></p>
    </div>
  </div>`;
}




// Crops the middle square of the photo and shrinks it to 400 px before sending
function squarePhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Choose a JPG, PNG or WebP photo.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That photo could not be read. Try another one.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = reader.onerror;
      img.onload = () => {
        const s = Math.min(img.width, img.height), c = document.createElement('canvas');
        c.width = c.height = 400;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 400, 400);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 400, 400);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function afterPhoto(has, text) {
  state.user.hasPhoto = has;
  state.photoV = Date.now();
  localStorage.setItem('user', JSON.stringify(state.user));
  renderNav();
  await renderDash();
}
async function uploadPhoto() {
  try {
    const image = await squarePhoto($('#pf').files[0]);
    await api('/me/photo', { method: 'PUT', body: { image } });
    await afterPhoto(true, 'Profile photo saved.');
  } catch (err) { showMessage($('#pmsg'), err.message, false); }
}
async function removePhoto() {
  try { await api('/me/photo', { method: 'DELETE' }); await afterPhoto(false, 'Profile photo removed.'); }
  catch (err) { showMessage($('#pmsg'), err.message, false); }
}