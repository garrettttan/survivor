// Site: the admin lock in the header's top right. Signed out it's an icon-only lock that opens a sign-in
// form in the detail panel; signed in as an admin it shows the email and opens a panel with the admin pages
// and Sign out.

let adminUser = null;

function renderAdminButton() {
  const btn = document.getElementById('admin-button');
  btn.innerHTML = adminUser ? `${ICONS.lock}<span class="admin-email">${escapeHtml(adminUser.email)}</span>` : ICONS.lock;
  btn.classList.toggle('signed-in', !!adminUser);
  btn.setAttribute('aria-label', adminUser ? 'Admin menu' : 'Admin sign in');
  btn.hidden = false;
}

function openAdminSheet() {
  if (adminUser) {
    showSheet(`
      <div class="sheet-hero-name">Admin</div>
      <p class="admin-note">Signed in as ${escapeHtml(adminUser.email)}</p>
      <a class="admin-submit admin-link" href="${seasonUrl('admin.html', currentEntry.season)}">Add events</a>
      <button type="button" class="admin-submit admin-secondary" id="admin-sign-out">Sign out</button>
    `);
    return;
  }
  showSheet(signInFormHtml());
  // Phones skip this so the keyboard doesn't jump up mid-animation
  if (isDesktop()) document.querySelector('#admin-form input').focus();
}

async function setUpAdminButton() {
  adminUser = await getAdminUser();
  renderAdminButton();
  onAdminChange(user => {
    adminUser = user;
    renderAdminButton();
  });
  document.getElementById('admin-button').addEventListener('click', openAdminSheet);
}

bindSignInForm(document.getElementById('sheet-body'), user => {
  adminUser = user;
  renderAdminButton();
  closeSheet();
});

document.getElementById('sheet-body').addEventListener('click', async e => {
  if (!e.target.closest('#admin-sign-out')) return;
  await signOut();
  adminUser = null;
  renderAdminButton();
  closeSheet();
});
