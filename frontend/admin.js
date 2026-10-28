// Frontend: the "Add events" admin page for the season in the URL (?season=N). Shows the sign-in form until
// an admin is signed in. The event form itself isn't built yet.

function renderAdminPage(user) {
  const body = document.getElementById('admin-body');
  if (!user) {
    body.innerHTML = `<div class="admin-card">${signInFormHtml()}</div>`;
    return;
  }
  body.innerHTML = `
    <section>
      <h2 class="section-title">➕ ADD EVENTS</h2>
      <p class="admin-note">Signed in as ${escapeHtml(user.email)} ·
        <button type="button" class="admin-text-button" id="admin-sign-out">Sign out</button></p>
    </section>
  `;
}

async function adminMain() {
  const adminEntry = await currentSeason(fetchSeasons());
  const backLink = document.getElementById('back-link');
  backLink.href = seasonUrl('index.html', adminEntry.season);
  backLink.innerHTML = `${ICONS.chevronLeft}S${adminEntry.season}`;
  document.getElementById('admin-title').textContent = `${adminEntry.title} · Admin`;
  document.title = `Add events · ${adminEntry.title}`;

  const body = document.getElementById('admin-body');
  bindSignInForm(body, renderAdminPage);
  body.addEventListener('click', async e => {
    if (!e.target.closest('#admin-sign-out')) return;
    await signOut();
    renderAdminPage(null);
  });
  onAdminChange(renderAdminPage);
  renderAdminPage(await getAdminUser());
}

adminMain();
