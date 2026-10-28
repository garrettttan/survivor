// Frontend: the "Add events" admin page for the season in the URL (?season=N). Shows the sign-in form until
// an admin is signed in, then the episode entry form: pick the episode, describe it as cards, save. Each change
// is checked in the background (a preview), which keeps the game panel, pickers and errors current. Every rule
// lives in the episode-entry function (backend/admin-data.js); this file keeps the form's state and draws it.
// Episodes already entered can't be edited here yet.

// The season in the URL, taken as given: entering events doesn't need the season to have a draft
const adminSeason = Number(new URLSearchParams(location.search).get('season')) || CONFIG.DEFAULT_SEASON.season;
const adminTitle = `Season ${adminSeason}`;

const PREVIEW_DELAY_MS = 400;

const entry = {
  userId: null,          // the admin the form was drawn for (auth events repeat; only a new user redraws)
  episode: null,
  ctx: null,             // getEpisodeState's reply plus short names: what every card form draws from (admin-cards.js)
  entered: false,        // the episode already has saved rows (editing them isn't supported yet)
  cards: [],
  draftHandled: false,   // the restore offer was answered, or you started over
  preview: null,         // the latest previewEpisode result
  previewError: null,    // why the latest preview call failed
  previewPending: false, // a change hasn't been previewed yet
  previewToken: 0,       // drops replies that a newer request has overtaken
  previewTimer: null,
  saving: false,
  flash: null,           // { episode, inserted } after a save
  shownHolder: null,     // the castaway whose advantages the game panel is showing (tap their pill)
};

// What each card was last drawn from, so a new preview redraws only the ones whose pickers changed
const drawnWith = new WeakMap();

// ── Draft autosave ────────────────────────────────────────────────────────
// The cards are kept per season and episode until saved, so a closed tab loses nothing.
// Storage can be unavailable (private mode), so every access is wrapped.
function draftKey() {
  return `episode-entry:${adminSeason}:${entry.episode}`;
}

function saveDraft() {
  try {
    if (!entry.cards.length) localStorage.removeItem(draftKey());
    else localStorage.setItem(draftKey(), JSON.stringify({ cards: entry.cards, savedAt: Date.now() }));
  } catch { /* nothing to do */ }
}

function readDraft() {
  try {
    return JSON.parse(localStorage.getItem(draftKey()));
  } catch {
    return null;
  }
}

function clearDraft() {
  try { localStorage.removeItem(draftKey()); } catch { /* nothing to do */ }
}

// ── Preview ───────────────────────────────────────────────────────────────
function schedulePreview() {
  clearTimeout(entry.previewTimer);
  entry.previewTimer = setTimeout(runPreview, PREVIEW_DELAY_MS);
  if (entry.previewPending) return;
  entry.previewPending = true;
  renderSaveBar();
}

async function runPreview() {
  const token = ++entry.previewToken;
  try {
    const result = await previewEpisode(adminSeason, entry.episode, entry.cards.map(cardPayload));
    if (token !== entry.previewToken) return;
    entry.preview = result;
    entry.previewError = null;
  } catch (err) {
    if (token !== entry.previewToken) return;
    entry.preview = null;
    entry.previewError = err.message;
  }
  entry.previewPending = false;
  refreshAfterPreview();
}

// The game just before card `index` (index = cards.length: after them all), from the latest preview while it
// reaches that far, else the episode's start
function gameBefore(index) {
  const states = entry.preview?.states;
  if (!states?.length) return entry.ctx.game;
  return states[Math.min(index, states.length - 1)];
}

function errorsFor(index) {
  return (entry.preview?.errors || []).filter(e => e.card === index);
}

// The rows card `index` will save, as of the latest preview
function rowsFor(index) {
  return (entry.preview?.rows || []).filter(r => r.card === index);
}

// ── Loading an episode ────────────────────────────────────────────────────
async function loadEpisode(episode) {
  clearTimeout(entry.previewTimer);
  entry.previewToken++;
  const form = document.getElementById('entry-form');
  form.innerHTML = '<p class="entry-loading">🔥 Loading episode…</p>';
  let state;
  try {
    state = await getEpisodeState(adminSeason, episode);
  } catch (err) {
    form.innerHTML = `<p class="admin-error">Couldn't load the episode: ${escapeHtml(err.message)}</p>`;
    return;
  }
  const short = shortNames(state.castaways);
  entry.ctx = { ...state, short: new Map(state.castaways.map(c => [c.id, short.get(c.name)])) };
  entry.episode = state.episode;
  entry.entered = state.episode <= state.maxEpisode;
  entry.cards = [];
  entry.draftHandled = false;
  entry.preview = null;
  entry.previewError = null;
  entry.previewPending = false;
  renderForm();
}

// ── Rendering ─────────────────────────────────────────────────────────────
function renderAdminPage(user) {
  const body = document.getElementById('admin-body');
  if (!user) {
    entry.userId = null;
    body.innerHTML = `<div class="admin-card">${signInFormHtml()}</div>`;
    return;
  }
  if (entry.userId === user.id) return;
  entry.userId = user.id;
  body.innerHTML = `
    <div class="entry-page">
      <p class="admin-note">Signed in as ${escapeHtml(user.email)} ·
        <button type="button" class="admin-text-button" id="admin-sign-out">Sign out</button></p>
      <div id="entry-form"></div>
    </div>
  `;
  loadEpisode(null);
}

// An episode that's already entered shows only the episode picker, to pick another
function renderForm() {
  document.getElementById('entry-form').innerHTML = `
    <section class="entry-panel" id="entry-episode"></section>
    <div id="entry-flash"></div>
    ${entry.entered ? '' : `
    <div id="entry-restore"></div>
    <section class="entry-panel" id="entry-game"></section>
    <section id="entry-cards"></section>
    <div id="entry-notes"></div>
    <div class="entry-save-bar" id="entry-save-bar"></div>`}
  `;
  renderEpisodeHeader();
  renderFlash();
  if (entry.entered) return;
  renderRestoreOffer();
  renderGame();
  renderCards();
  renderNotes();
  renderSaveBar();
}

function renderEpisodeHeader() {
  const { maxEpisode } = entry.ctx;
  const note = entry.entered
    ? `Episode ${entry.episode} is already entered. Editing entered episodes isn't available yet.`
    : maxEpisode ? `Episodes 1–${maxEpisode} are entered.` : 'No episodes entered yet.';
  document.getElementById('entry-episode').innerHTML = `
    <label class="entry-episode-picker">
      <span class="entry-label">Episode</span>
      <input class="entry-input entry-count" type="number" min="1" inputmode="numeric" id="entry-episode-input" value="${entry.episode}">
    </label>
    <p class="entry-hint${entry.entered ? ' entry-warn' : ''}">${escapeHtml(note)}</p>
  `;
}

function renderFlash() {
  const el = document.getElementById('entry-flash');
  const { flash } = entry;
  el.innerHTML = flash ? `<p class="entry-flash">Saved episode ${flash.episode} (${flash.inserted} rows).
    <a href="${seasonUrl('index.html', adminSeason)}">See the standings</a></p>` : '';
}

function renderRestoreOffer() {
  const el = document.getElementById('entry-restore');
  const draft = entry.draftHandled ? null : readDraft();
  if (!draft?.cards?.length) {
    el.innerHTML = '';
    return;
  }
  const when = new Date(draft.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  el.innerHTML = `<div class="entry-restore">
    <span>Unsaved work for episode ${entry.episode} from ${escapeHtml(when)}.</span>
    <span class="entry-restore-actions">
      <button type="button" class="admin-text-button" data-draft="restore">Restore</button>
      <button type="button" class="admin-text-button" data-draft="discard">Discard</button>
    </span>
  </div>`;
}

// A pill per castaway. An advantage holder's pill has a purple outline and dot, and is the only one you can tap:
// it opens a popover under the pill listing what they hold.
function memberPillsHtml(ids, game, out = false) {
  return `<div class="entry-chips">${ids.map(id => {
    const name = escapeHtml(entry.ctx.short.get(id));
    if (out || !game.held[id]?.length) return `<span class="entry-member${out ? ' out' : ''}">${name}</span>`;
    const shown = entry.shownHolder === id;
    return `<span class="entry-holder">
      <button type="button" class="entry-member holds-adv" data-holder="${id}" aria-expanded="${shown}">${name}</button>
      ${shown ? `<ul class="entry-adv-pop" role="tooltip">${game.held[id].map(a => `<li>${escapeHtml(a.name)}</li>`).join('')}</ul>` : ''}
    </span>`;
  }).join('')}</div>`;
}

// Each tribe still in play with its members, then everyone who's out, as of the end of the cards so far
function renderGame() {
  const ctx = cardCtx(entry.cards.length);
  const { game } = ctx;
  const tribes = tribesInPlay(ctx).map(t => {
    const members = membersOf(t.id, ctx);
    return `<div class="entry-tribe" style="${tribeStyleVars(t.color)}">
      <div class="entry-tribe-name">${escapeHtml(t.name)} · ${members.length}</div>
      ${memberPillsHtml(members, game)}
    </div>`;
  }).join('');
  const out = byShortName(game.out, ctx);
  document.getElementById('entry-game').innerHTML = `
    <h2 class="entry-heading">Game ${entry.cards.length ? 'after these cards' : `at the start of episode ${entry.episode}`}</h2>
    <div class="entry-tribes">${tribes}</div>
    ${out.length ? `<div class="entry-out"><span class="entry-label">Out</span>
      ${memberPillsHtml(out, game, true)}</div>` : ''}
  `;
  // A popover that would run off the right edge of the screen opens leftward instead
  const pop = document.querySelector('.entry-adv-pop');
  if (pop && pop.getBoundingClientRect().right > document.documentElement.clientWidth - 8) pop.classList.add('flip');
}

function hideHolder() {
  if (entry.shownHolder === null) return;
  entry.shownHolder = null;
  renderGame();
}

function cardCtx(index) {
  return { ...entry.ctx, game: gameBefore(index) };
}

function renderCards() {
  const buttons = Object.entries(CARD_TYPES).map(([type, { label }]) =>
    `<button type="button" class="entry-add" data-add="${type}">+ ${escapeHtml(label)}</button>`).join('');
  document.getElementById('entry-cards').innerHTML = `
    <h2 class="entry-heading">Cards</h2>
    <div class="entry-list" id="entry-card-list">${entry.cards.map((_, i) => cardBlockHtml(i)).join('')}</div>
    ${entry.cards.length ? '' : '<p class="entry-hint">Add what happened, in the order it aired.</p>'}
    <div class="entry-add-row">${buttons}</div>
  `;
}

function cardBlockHtml(index) {
  const card = entry.cards[index];
  const ctx = cardCtx(index);
  drawnWith.set(card, JSON.stringify(ctx.game));
  return cardHtml(card, index, entry.cards.length, ctx, errorsFor(index), rowsFor(index));
}

function redrawCard(index) {
  const wrap = document.createElement('div');
  wrap.innerHTML = cardBlockHtml(index);
  document.querySelector(`[data-card="${index}"]`).replaceWith(wrap.firstElementChild);
}

// Updates a card's rows and errors in place, leaving its inputs (and focus) alone
function updateCardResults(el, index) {
  const errors = errorsFor(index);
  el.classList.toggle('has-errors', errors.length > 0);
  el.querySelector('.entry-card-rows')?.remove();
  el.querySelector('.entry-errors')?.remove();
  el.insertAdjacentHTML('beforeend', cardRowsHtml(rowsFor(index), cardCtx(index)) + errorListHtml(errors));
}

// After a preview: redraw cards whose game changed (unless you're typing in one), and refresh every card's rows
// and errors
function refreshAfterPreview() {
  renderGame();
  entry.cards.forEach((card, i) => {
    const el = document.querySelector(`[data-card="${i}"]`);
    if (!el) return;
    if (drawnWith.get(card) !== JSON.stringify(gameBefore(i)) && !el.contains(document.activeElement)) redrawCard(i);
    else updateCardResults(el, i);
  });
  renderNotes();
  renderSaveBar();
}

// What the latest preview says about the episode as a whole (problems with one card show on it), and
// why a preview failed
function renderNotes() {
  const el = document.getElementById('entry-notes');
  if (entry.previewError) {
    el.innerHTML = `<p class="admin-error">Couldn't check the episode: ${escapeHtml(entry.previewError)}</p>`;
    return;
  }
  const errors = (entry.preview?.errors || []).filter(e => e.card == null);
  const warnings = entry.preview?.warnings || [];
  el.innerHTML = errorListHtml(errors) +
    (warnings.length ? `<ul class="entry-warnings">${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : '');
}

// Save is enabled only for a preview of exactly what's on screen, with no errors
function saveState() {
  if (entry.saving) return { ready: false, status: 'Saving…' };
  if (!entry.cards.length) return { ready: false, status: 'Add a card to start.' };
  if (entry.previewPending) return { ready: false, status: 'Checking…' };
  if (entry.previewError || !entry.preview) return { ready: false, status: "Can't save until the episode is checked." };
  const errors = entry.preview.errors.length;
  if (errors) return { ready: false, status: `Fix ${errors} ${errors === 1 ? 'problem' : 'problems'} to save.` };
  const rows = entry.preview.rows.length;
  return { ready: true, status: `${rows} ${rows === 1 ? 'row' : 'rows'} ready.` };
}

function renderSaveBar() {
  const el = document.getElementById('entry-save-bar');
  if (!el) return;
  const { ready, status } = saveState();
  el.innerHTML = `
    <span class="entry-save-status">${escapeHtml(status)}</span>
    <button type="button" class="admin-submit" id="entry-save"${ready ? '' : ' disabled'}>Save episode</button>
  `;
}

// ── Actions ───────────────────────────────────────────────────────────────
// Every edit: autosave, re-preview, and drop an old "Saved" message. Editing without restoring starts over,
// so the autosave replaces the old draft and the offer goes away.
function formChanged() {
  if (entry.flash) {
    entry.flash = null;
    renderFlash();
  }
  if (!entry.draftHandled) {
    entry.draftHandled = true;
    renderRestoreOffer();
  }
  saveDraft();
  schedulePreview();
}

async function save() {
  entry.saving = true;
  renderSaveBar();
  try {
    const result = await saveEpisode(adminSeason, entry.episode, entry.cards.map(cardPayload));
    entry.saving = false;
    if (result.errors?.length) {
      entry.preview = { ...entry.preview, errors: result.errors };
      refreshAfterPreview();
      return;
    }
    clearDraft();
    entry.flash = { episode: entry.episode, inserted: result.inserted };
    await loadEpisode(null);
  } catch (err) {
    entry.saving = false;
    renderSaveBar();
    document.querySelector('.entry-save-status').textContent = `Save failed: ${err.message}`;
  }
}

function moveItem(list, index, delta) {
  const to = index + delta;
  if (to < 0 || to >= list.length) return;
  [list[index], list[to]] = [list[to], list[index]];
}

// Up, down and delete on a card
function handleItemAction(button) {
  const index = Number(button.closest('[data-card]').dataset.card);
  const { action } = button.dataset;
  if (action === 'delete') entry.cards.splice(index, 1);
  else moveItem(entry.cards, index, action === 'up' ? -1 : 1);
  renderCards();
  formChanged();
}

function handleInput(el) {
  const cardEl = el.closest('[data-card]');
  if (!cardEl) return;
  const index = Number(cardEl.dataset.card);
  applyInput(entry.cards[index], el, cardCtx(index));
  if (el.dataset.rerender !== undefined) redrawCard(index);
  formChanged();
}

function restoreDraft() {
  const draft = readDraft();
  entry.draftHandled = true;
  entry.cards = draft.cards || [];
  renderForm();
  schedulePreview();
}

function bindEntryForm(body) {
  // Selects, checkboxes and radios report on change; text and number boxes on every keystroke
  body.addEventListener('change', e => {
    if (e.target.id === 'entry-episode-input') {
      const episode = Number(e.target.value);
      if (episode >= 1 && episode !== entry.episode) {
        entry.flash = null;
        loadEpisode(episode);
      }
      return;
    }
    if (e.target.matches('select, input[type=checkbox], input[type=radio]')) handleInput(e.target);
  });
  body.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideHolder();
  });
  body.addEventListener('input', e => {
    if (e.target.matches('input[type=text], input[type=number]') && e.target.id !== 'entry-episode-input') handleInput(e.target);
  });
  body.addEventListener('click', async e => {
    if (!e.target.closest('[data-holder]')) hideHolder();   // a tap anywhere else closes the advantages popover
    const target = e.target.closest('button');
    if (!target) return;
    if (target.id === 'admin-sign-out') {
      await signOut();
      renderAdminPage(null);
    } else if (target.id === 'entry-save') {
      save();
    } else if (target.dataset.add) {
      entry.cards.push(newCard(target.dataset.add, cardCtx(entry.cards.length)));
      renderCards();
      renderGame();
      document.querySelector(`[data-card="${entry.cards.length - 1}"]`).scrollIntoView({ behavior: 'smooth', block: 'center' });
      formChanged();
    } else if (target.dataset.holder) {
      const id = Number(target.dataset.holder);
      entry.shownHolder = entry.shownHolder === id ? null : id;
      renderGame();
    } else if (target.dataset.action) {
      handleItemAction(target);
    } else if (target.dataset.draft === 'restore') {
      restoreDraft();
    } else if (target.dataset.draft === 'discard') {
      entry.draftHandled = true;
      clearDraft();
      renderRestoreOffer();
    }
  });
}

async function adminMain() {
  const backLink = document.getElementById('back-link');
  backLink.href = seasonUrl('index.html', adminSeason);
  backLink.innerHTML = `${ICONS.chevronLeft}S${adminSeason}`;
  document.getElementById('admin-season').textContent = adminTitle;
  document.title = `Add events · ${adminTitle}`;

  const body = document.getElementById('admin-body');
  bindSignInForm(body, renderAdminPage);
  bindEntryForm(body);
  onAdminChange(renderAdminPage);
  renderAdminPage(await getAdminUser());
}

adminMain();
