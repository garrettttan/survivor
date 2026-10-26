// Frontend: page setup — asks the backend for the draft's data, then renders every section.

let appData = null;          // backend result for the current draft, plus colors from assignColors
let scoring = {};            // category → [{ name, description, points }] shown on the scoring tab

// ── Scoring tab ───────────────────────────────────────────────────────────
// Leaves out 0-point rules, and categories with nothing left
function renderScoring() {
  document.getElementById('scoring-grid').innerHTML = Object.entries(scoring).map(([category, rules]) => {
    const scored = rules.filter(r => r.points !== 0);
    return scored.length ? `
    <div class="scoring-cat">
      <h4>${escapeHtml(category)}</h4>
      ${scored.map(scoringRuleHtml).join('')}
    </div>
  ` : '';
  }).join('');
}

// A rule with a description opens on tap to show it underneath
function scoringRuleHtml(r) {
  const pts = `<span class="scoring-pts">${fmt(r.points)}</span>`;
  if (!r.description) return `<div class="scoring-row"><span>${escapeHtml(r.name)}</span>${pts}</div>`;
  return `<div class="scoring-rule">
      <button type="button" class="scoring-row" aria-expanded="false"><span>${escapeHtml(r.name)}</span>${pts}</button>
      <div class="collapse-wrap"><div class="collapse-inner"><div class="scoring-desc">${escapeHtml(r.description)}</div></div></div>
    </div>`;
}

// Toggle a rule to show its description
document.getElementById('scoring-grid').addEventListener('click', e => {
  const btn = e.target.closest('.scoring-rule > .scoring-row');
  if (!btn) return;
  const open = btn.parentElement.classList.toggle('open');
  btn.setAttribute('aria-expanded', open);
});

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
  h1.textContent = img.alt;
  img.replaceWith(h1);
}

function setUpLogo(entry) {
  const logoEl = document.getElementById('page-title');
  logoEl.addEventListener('error', () => handleLogoError(logoEl));
  logoEl.alt = entry.title;
  logoEl.src = entry.logo;
  document.title = entry.title;
}

// ── Season picker ─────────────────────────────────────────────────────────
// The season in the URL (?season=N), or the first in CONFIG.SEASONS
function currentSeason() {
  const param = new URLSearchParams(location.search).get('season');
  return CONFIG.SEASONS.find(s => String(s.season) === param) || CONFIG.SEASONS[0];
}

// A small "S51 ▾" pill in the header's top left. The native select sits invisibly over it, so tapping opens
// the platform picker; choosing a season reloads the page with it in the URL (dropped for the default).
function setUpSeasonPicker(entry) {
  if (CONFIG.SEASONS.length < 2) return;
  const picker = document.getElementById('season-picker');
  picker.innerHTML = `
    S${entry.season}${ICONS.chevronDown}
    <select aria-label="Season">
      ${CONFIG.SEASONS.map(s => `<option value="${s.season}"${s === entry ? ' selected' : ''}>${escapeHtml(s.title)}</option>`).join('')}
    </select>
  `;
  picker.hidden = false;
  picker.querySelector('select').addEventListener('change', e => {
    const url = new URL(location.href);
    if (e.target.value === String(CONFIG.SEASONS[0].season)) url.searchParams.delete('season');
    else url.searchParams.set('season', e.target.value);
    location.href = url.href;
  });
}

// ── Main ──────────────────────────────────────────────────────────────────
function showError(message) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('error-msg').style.display = 'block';
  document.getElementById('error-detail').textContent = message;
}

async function main() {
  const entry = currentSeason();
  setUpLogo(entry);
  setUpSeasonPicker(entry);
  try {
    const season = await loadSeason(entry);
    appData = season.data;
    scoring = season.scoring;
    assignColors(appData);

    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display = 'block';

    renderStandings(appData);
    renderTeamChartControls();
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
