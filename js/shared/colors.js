// Shared: the color palette and helpers for drawing things in a tribe's or team's color. Used by both pages.

// Team colors, given out in alphabetical team order (js/site/badges.js), and the admin page's challenge teams
const PALETTE = [
  '#ea580c', // orange
  '#ca8a04', // yellow
  '#16a34a', // green
  '#0284c7', // sky
  '#7c3aed', // violet
  '#db2777', // pink
  '#0d9488', // teal
  '#64748b', // slate
];

// For a tribe with no color set
const FALLBACK_COLOR = '#64748b';

// "#rrggbb" → [r, g, b]
function hexToRgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}

// "#rrggbb" → "rgba(r,g,b,alpha)"
function hexToRgba(hex, alpha) {
  return `rgba(${hexToRgb(hex).join(',')},${alpha})`;
}

// The text color to put on a fill: dark on light fills, white on dark ones
function contrastText(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#2b1d0e' : '#ffffff';
}

// Inline CSS variables for something drawn in a tribe's (or team's) color: --tribe, --tribe-contrast for text on
// it, and --tribe-tint for a light fill (`tint` = its opacity)
function tribeStyleVars(color, tint = 0.1) {
  const c = color || FALLBACK_COLOR;
  return `--tribe:${c};--tribe-contrast:${contrastText(c)};--tribe-tint:${hexToRgba(c, tint)}`;
}
