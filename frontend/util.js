// Frontend: small formatting and HTML helpers shared by the renderers.

// 12 → "12", 12.5 → "12.5"
function fmt(n) {
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

// Data from the server is inserted with innerHTML, so escape it first
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Short display names, keyed by full name: the castaway's first name (e.g. "Thien An") if set, else the first word.
// Adds a last initial when short names clash ("John A.", "John C."), and the full name if that still clashes.
function shortNames(castaways) {
  const parts = new Map();
  castaways.forEach(({ name, firstName }) => {
    if (parts.has(name)) return;
    const words = name.trim().split(/\s+/);
    const base = firstName || words[0];
    // Last name is what follows the short name ("Thien An Nguyen" → "Nguyen"), or the words after the first
    const rest = name.startsWith(base) ? name.slice(base.length).trim() : words.slice(1).join(' ');
    parts.set(name, { base, initialed: rest ? `${base} ${rest[0]}.` : base });
  });
  const counts = key => [...parts.values()].reduce((m, p) => m.set(p[key], (m.get(p[key]) || 0) + 1), new Map());
  const baseCounts = counts('base'), initialedCounts = counts('initialed');
  return new Map([...parts].map(([name, p]) => [name,
    baseCounts.get(p.base) === 1 ? p.base : initialedCounts.get(p.initialed) === 1 ? p.initialed : name]));
}

function chevronIcon(points, className = '') {
  return `<svg${className ? ` class="${className}"` : ''} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="${points}"/></svg>`;
}

const ICONS = {
  chevronRight: chevronIcon('9 6 15 12 9 18', 'row-chevron'),
  chevronDown: chevronIcon('6 9 12 15 18 9'),
  chevronLeft: chevronIcon('15 6 9 12 15 18'),
  lock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};

// The season in the URL (?season=N), or the first in CONFIG.SEASONS
function currentSeason() {
  const param = new URLSearchParams(location.search).get('season');
  return CONFIG.SEASONS.find(s => String(s.season) === param) || CONFIG.SEASONS[0];
}

// Match the `@media (max-width: 640px)` and `(min-width: 768px)` breakpoints in styles.css
function isPhone() {
  return window.matchMedia('(max-width: 640px)').matches;
}

function isDesktop() {
  return window.matchMedia('(min-width: 768px)').matches;
}
