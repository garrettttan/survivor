// Frontend: page setup — picks the draft, asks the backend for its data, then renders every section.

let appData = null;          // backend result for the current draft, plus colors from assignColors
let scoringRules = [];       // shown on the scoring tab
let hiddenEvents = new Set(); // lowercased events left out of the castaway event log

// ── Draft picker ──────────────────────────────────────────────────────────
const DRAFT_STORAGE_KEY = 'survivor.draft';

// ?draft=<Draft name>, then the viewer's last choice, then the first listed draft
function pickDraft(drafts) {
  const byName = name => drafts.find(d => d.name.toLowerCase() === name.trim().toLowerCase());

  const requested = new URLSearchParams(window.location.search).get('draft');
  if (requested) {
    const draft = byName(requested);
    if (!draft) throw new Error(`Unknown draft "${requested}" — add it to the "${CONFIG.SHEETS.drafts}" sheet.`);
    return draft;
  }

  let saved = null;
  try { saved = localStorage.getItem(DRAFT_STORAGE_KEY); } catch (_) {}
  return (saved && byName(saved)) || drafts[0];
}

function renderDraftPicker(drafts, current) {
  const select = document.getElementById('draft-select');
  select.innerHTML = '';
  if (!current) select.add(new Option('Choose…', '', true, true));
  drafts.forEach(d => select.add(new Option(d.name, d.name, false, current === d)));
  select.onchange = () => {
    if (!select.value) return;
    try { localStorage.setItem(DRAFT_STORAGE_KEY, select.value); } catch (_) {}
    window.location.search = '?draft=' + encodeURIComponent(select.value);
  };
  document.getElementById('draft-picker').hidden = drafts.length < 2;
}

// ── Scoring tab ───────────────────────────────────────────────────────────
function renderScoring() {
  // Group rules by category, preserving order
  const categories = [];
  const catMap = {};
  scoringRules.forEach(r => {
    if (!catMap[r.category]) {
      catMap[r.category] = [];
      categories.push(r.category);
    }
    catMap[r.category].push(r);
  });

  document.getElementById('scoring-grid').innerHTML = categories.map(cat => `
    <div class="scoring-cat">
      <h4>${escapeHtml(cat)}</h4>
      ${catMap[cat].map(r => `<div class="scoring-row"><span>${escapeHtml(r.event)}</span><span class="scoring-pts">${escapeHtml(r.points)}</span></div>`).join('')}
    </div>
  `).join('');
}

// ── Section tabs ──────────────────────────────────────────────────────────
// Highlight the tab for the section currently in view
function initSectionTabs() {
  const nav = document.getElementById('section-tabs');
  const links = [...nav.querySelectorAll('a')];
  const setActive = id => links.forEach(a => {
    const on = a.getAttribute('href') === '#' + id;
    a.classList.toggle('active', on);
    // Keep the active tab visible in the bar (without touching page scroll)
    if (on && (a.offsetLeft < nav.scrollLeft || a.offsetLeft + a.offsetWidth > nav.scrollLeft + nav.clientWidth)) {
      nav.scrollLeft = a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2;
    }
  });
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) setActive(e.target.id); });
  }, { rootMargin: '-20% 0px -70% 0px' });
  document.querySelectorAll('main section[id]').forEach(sec => observer.observe(sec));
}

// ── Header logo ───────────────────────────────────────────────────────────
// Swap a missing logo image for the season title as text
function handleLogoError(img) {
  const h1 = document.createElement('h1');
  h1.id = 'page-title';
  h1.className = 'header-logo-text';
  h1.textContent = img.alt || CONFIG.SEASON_TITLE;
  img.replaceWith(h1);
}

function setUpLogo() {
  const logoEl = document.getElementById('page-title');
  logoEl.addEventListener('error', () => handleLogoError(logoEl));
  logoEl.alt = CONFIG.SEASON_TITLE;
  logoEl.src = CONFIG.LOGO;
  document.title = CONFIG.SEASON_TITLE;
}

// ── Main ──────────────────────────────────────────────────────────────────
function showError(message) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('error-msg').style.display = 'block';
  document.getElementById('error-detail').textContent = message;
}

async function main() {
  setUpLogo();
  try {
    const drafts = await loadDrafts();
    renderDraftPicker(drafts, null); // usable even if the requested draft is unknown
    const draft = pickDraft(drafts);
    renderDraftPicker(drafts, draft);
    try { localStorage.setItem(DRAFT_STORAGE_KEY, draft.name); } catch (_) {}

    const season = await loadSeason(draft.id);
    appData = season.data;
    scoringRules = season.scoringRules;
    hiddenEvents = season.hiddenEvents;
    assignColors(appData, season.tribeColorConfig);

    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display = 'block';

    renderStandings(appData);
    renderTeamChart(appData);
    renderOverviewFilters();
    renderOverviewTable(appData);
    renderScoring();
    initSectionTabs();
  } catch (err) {
    showError(err.message);
  }
}

// iOS Safari only applies :active styles when a touch listener is registered
document.addEventListener('touchstart', () => {}, { passive: true });

main();
