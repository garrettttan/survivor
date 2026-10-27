// Frontend: the admin sign-in form, shared by the header lock's panel and the admin page.

function signInFormHtml() {
  return `
    <form class="admin-form" id="admin-form">
      <div class="sheet-hero-name">Admin sign in</div>
      <input type="email" name="email" placeholder="Email" autocomplete="username" required>
      <input type="password" name="password" placeholder="Password" autocomplete="current-password" required>
      <p class="admin-error" id="admin-error" hidden></p>
      <button type="submit" class="admin-submit">Sign in</button>
    </form>
  `;
}

// Handles the form whenever it's inside `container` (which can re-render it), calling onSignedIn(user)
// after a successful admin sign-in
function bindSignInForm(container, onSignedIn) {
  container.addEventListener('submit', async e => {
    if (e.target.id !== 'admin-form') return;
    e.preventDefault();
    const form = e.target;
    const submit = form.querySelector('.admin-submit');
    const errorEl = form.querySelector('#admin-error');
    submit.disabled = true;
    errorEl.hidden = true;
    try {
      onSignedIn(await signIn(form.email.value.trim(), form.password.value));
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      submit.disabled = false;
    }
  });
}
