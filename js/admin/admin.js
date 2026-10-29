// Admin page: "Add events" for the season in the URL (?season=N). Shows the sign-in form until
// an admin is signed in, then the episode entry form: pick the episode, describe it as cards, save. Each change
// is checked in the background (a preview), which keeps the game panel, pickers and errors current. Every rule
// lives in the episode-entry function (js/api/admin-data.js); this file keeps the form's state and draws it.
// An episode that's already entered opens as its cards, to edit: its preview also shows what the edit changes in
// it and in every later episode, and saving replaces them all at once.

// The season in the URL, taken as given: entering events doesn't need the season to have a draft
const adminSeason = Number(new URLSearchParams(location.search).get('season')) || CONFIG.DEFAULT_SEASON.season;
const adminTitle = `Season ${adminSeason}`;

const PREVIEW_DELAY_MS = 400;

const entry = {
  userId: null,          // the admin the form was drawn for (auth events repeat; only a new user redraws)
  episode: null,
  ctx: null,             // getEpisodeState's reply plus short names: what every card form draws from (admin-cards.js)
  editing: false,        // the episode is already entered: its cards were loaded, and saving replaces it
  cards: [],
  draftHandled: false,   // the restore offer was answered, or you started over
  preview: null,         // the latest previewEpisode result
  previewError: null,    // why the latest preview call failed
  previewPending: false, // a change hasn't been previewed yet
  previewToken: 0,       // drops replies that a newer request has overtaken
  previewTimer: null,
  saving: false,
  flash: null,           // { episode, inserted } after saving a new episode, { episodes } after saving an edit
  shownHolder: null,     // the castaway whose advantages the game panel is showing (tap their pill)
};

// What each card was last drawn from, so a new preview redraws only the ones whose pickers changed
const drawnWith = new WeakMap();

// ── Draft autosave ────────────────────────────────────────────────────────
// The cards are kept per season and episode until saved, so a closed tab loses nothing. An edit's draft is kept
// apart from a new episode's. Storage can be unavailable (private mode), so every access is wrapped.
function draftKey() {
  return `episode-entry:${adminSeason}:${entry.episode}${entry.editing ? ':edit' : ''}`;
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
    const result = await previewEpisode(adminSeason, entry.episode, entry.cards.map(cardPayload), entry.editing);
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

function hasChanges(changes) {
  return changes.added.length > 0 || changes.removed.length > 0;
}

// The episodes an edit's latest preview changes: this one, then any later ones
function changedEpisodes() {
  const p = entry.preview;
  if (!p?.changes) return [];
  return [...(hasChanges(p.changes) ? [entry.episode] : []),
    ...(p.later || []).filter(l => hasChanges(l.changes)).map(l => l.episode)];
}

// [4] → "episode 4", [4, 5, 6] → "episodes 4, 5 and 6"
function episodeList(episodes) {
  if (episodes.length === 1) return `episode ${episodes[0]}`;
  return `episodes ${episodes.slice(0, -1).join(', ')} and ${episodes[episodes.length - 1]}`;
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
  entry.editing = state.cards !== null;
  entry.cards = (state.cards || []).map(loadCard);
  entry.draftHandled = false;
  entry.preview = null;
  entry.previewError = null;
  entry.previewPending = entry.editing;
  renderForm();
  // An entered episode is checked straight away, for its rows and so saving it unchanged shows no changes
  if (entry.editing) runPreview();
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

// An entered episode also gets the changes its edit makes, above the save bar
function renderForm() {
  document.getElementById('entry-form').innerHTML = `
    <section class="entry-panel" id="entry-episode"></section>
    <div id="entry-flash"></div>
    <div id="entry-restore"></div>
    <section class="entry-panel" id="entry-game"></section>
    <section id="entry-cards"></section>
    <div id="entry-notes"></div>
    ${entry.editing ? '<section class="entry-panel" id="entry-changes"></section>' : ''}
    <div class="entry-save-bar" id="entry-save-bar"></div>
  `;
  renderEpisodeHeader();
  renderFlash();
  renderRestoreOffer();
  renderGame();
  renderCards();
  renderNotes();
  renderChanges();
  renderSaveBar();
}

// A button per entered episode, then one for the next, new episode; the open one is filled in
function renderEpisodeHeader() {
  const { maxEpisode, rebuilt, fallbacks } = entry.ctx;
  let note = maxEpisode ? `Entering episode ${entry.episode}, the next one.` : 'No episodes entered yet.';
  if (entry.editing) {
    note = `Editing episode ${entry.episode}, which is already entered. Saving replaces its rows, and the rows of any ` +
      'later episode the edit changes.';
    if (rebuilt) {
      note += ' Its cards were rebuilt from its saved rows' + (fallbacks.length
        ? `; ${fallbacks.length} ${fallbacks.length === 1 ? "row doesn't" : "rows don't"} match a card, so ${fallbacks.length === 1 ? 'it is a custom row' : 'they are custom rows'}.`
        : '.');
    }
  }
  const button = (episode, label, extra = '') => `<button type="button" class="entry-episode${extra}" data-episode="${episode}"
    aria-pressed="${episode === entry.episode}">${label}</button>`;
  const entered = Array.from({ length: maxEpisode }, (_, i) => button(i + 1, i + 1)).join('');
  document.getElementById('entry-episode').innerHTML = `
    <div class="entry-episode-row">
      <span class="entry-label" id="entry-episode-label">Episode</span>
      <div class="entry-episodes" role="group" aria-labelledby="entry-episode-label">
        ${entered}${button(maxEpisode + 1, `+ ${maxEpisode + 1}`, ' new')}
      </div>
      ${entry.editing ? '<span class="entry-editing">Editing</span>' : ''}
    </div>
    <p class="entry-hint${entry.editing ? ' entry-warn' : ''}">${escapeHtml(note)}</p>
  `;
}

function renderFlash() {
  const el = document.getElementById('entry-flash');
  const { flash } = entry;
  if (!flash) {
    el.innerHTML = '';
    return;
  }
  const what = flash.episodes ? `Saved changes to ${episodeList(flash.episodes)}.`
    : `Saved episode ${flash.episode} (${flash.inserted} rows).`;
  el.innerHTML = `<p class="entry-flash">${escapeHtml(what)}
    <a href="${seasonUrl('index.html', adminSeason)}">See the standings</a></p>`;
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
    <span>Unsaved ${entry.editing ? 'changes to' : 'work for'} episode ${entry.episode} from ${escapeHtml(when)}.</span>
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
  renderChanges();
  renderSaveBar();
}

// What an edit changes: this episode's rows added and removed, then each later episode the edit reaches, with
// any error it now has (a Tribal that no longer adds up) and a button to open it
function renderChanges() {
  const el = document.getElementById('entry-changes');
  if (!el) return;
  const p = entry.preview;
  const heading = '<h2 class="entry-heading">Changes</h2>';
  // While this episode has problems its broken cards make no rows, so every later episode would look broken too
  if (!p?.changes || p.errors.length) {
    el.innerHTML = heading + `<p class="entry-hint">${entry.previewError || entry.preview
      ? "Changes show once this episode's cards check out." : 'Checking…'}</p>`;
    return;
  }
  const rows = changes => cardRowsHtml(changes.added, entry.ctx, 'Adds') + cardRowsHtml(changes.removed, entry.ctx, 'Removes');
  const later = (p.later || []).filter(l => l.errors.length || hasChanges(l.changes));
  const unchanged = (p.later || []).length - later.length;
  el.innerHTML = heading + `
    <div class="entry-change">
      <h3 class="entry-change-title">Episode ${entry.episode} <span class="entry-hint">this episode</span></h3>
      ${hasChanges(p.changes) ? rows(p.changes) : '<p class="entry-hint">No changes.</p>'}
    </div>
    ${later.map(l => `<div class="entry-change">
      <h3 class="entry-change-title">Episode ${l.episode}
        <button type="button" class="admin-text-button" data-open-episode="${l.episode}">Open</button></h3>
      ${errorListHtml(l.errors.map(e => ({ message: e.card == null ? e.message : `Card ${e.card + 1}: ${e.message}` })))}
      ${rows(l.changes)}
    </div>`).join('')}
    ${unchanged ? `<p class="entry-hint">${later.length ? 'Other later episodes' : 'Later episodes'} don't change.</p>` : ''}
  `;
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
  // A later episode's errors count only once this episode has none: until then they follow from its broken cards
  const errors = entry.preview.errors.length || (entry.preview.later || []).reduce((n, l) => n + l.errors.length, 0);
  if (errors) return { ready: false, status: `Fix ${errors} ${errors === 1 ? 'problem' : 'problems'} to save.` };
  if (entry.editing) {
    const changed = changedEpisodes();
    if (!changed.length) return { ready: false, status: 'No changes to save.' };
    return { ready: true, status: `Changes ${episodeList(changed)}.` };
  }
  const rows = entry.preview.rows.length;
  return { ready: true, status: `${rows} ${rows === 1 ? 'row' : 'rows'} ready.` };
}

function renderSaveBar() {
  const el = document.getElementById('entry-save-bar');
  if (!el) return;
  const { ready, status } = saveState();
  el.innerHTML = `
    <span class="entry-save-status">${escapeHtml(status)}</span>
    <button type="button" class="admin-submit" id="entry-save"${ready ? '' : ' disabled'}>${entry.editing ? 'Save changes' : 'Save episode'}</button>
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

// A new episode is saved and the next one opens; an edit is saved and the episode opens again, as saved
async function save() {
  entry.saving = true;
  renderSaveBar();
  try {
    const write = entry.editing ? replaceEpisode : saveEpisode;
    const result = await write(adminSeason, entry.episode, entry.cards.map(cardPayload));
    entry.saving = false;
    if (result.errors?.length) {
      entry.preview = { ...entry.preview, errors: result.errors };
      refreshAfterPreview();
      return;
    }
    clearDraft();
    entry.flash = entry.editing ? { episodes: result.episodes } : { episode: entry.episode, inserted: result.inserted };
    await loadEpisode(entry.editing ? entry.episode : null);
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
    if (e.target.matches('select, input[type=checkbox], input[type=radio]')) handleInput(e.target);
  });
  body.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideHolder();
  });
  body.addEventListener('input', e => {
    if (e.target.matches('input[type=text], input[type=number]')) handleInput(e.target);
  });
  body.addEventListener('click', async e => {
    if (!e.target.closest('[data-holder]')) hideHolder();   // a tap anywhere else closes the advantages popover
    const target = e.target.closest('button');
    if (!target) return;
    if (target.id === 'admin-sign-out') {
      await signOut();
      renderAdminPage(null);
    } else if (target.dataset.episode) {
      const episode = Number(target.dataset.episode);
      if (episode !== entry.episode) {
        entry.flash = null;
        loadEpisode(episode);
      }
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
    } else if (target.dataset.openEpisode) {
      entry.flash = null;
      loadEpisode(Number(target.dataset.openEpisode));
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
