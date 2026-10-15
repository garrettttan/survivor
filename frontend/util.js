// Frontend: small formatting and HTML helpers shared by the renderers.

// 12 → "12", 12.5 → "12.5"
function fmt(n) {
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

// Sheet text is inserted with innerHTML, so escape it first
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// "Idol, Extra vote" → ['Idol', 'Extra vote']
function splitList(s) {
  return s ? s.split(',').map(a => a.trim()).filter(Boolean) : [];
}

function chevronIcon(points, className = '') {
  return `<svg${className ? ` class="${className}"` : ''} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="${points}"/></svg>`;
}

const ICONS = {
  chevronRight: chevronIcon('9 6 15 12 9 18', 'row-chevron'),
  chevronDown: chevronIcon('6 9 12 15 18 9'),
};

// Match the `@media (max-width: 640px)` and `(min-width: 768px)` breakpoints in styles.css
function isPhone() {
  return window.matchMedia('(max-width: 640px)').matches;
}

function isDesktop() {
  return window.matchMedia('(min-width: 768px)').matches;
}
