// Frontend: team and tribe colors, and the HTML that shows them.

// Color palette — assigned by alphabetical team order
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
const FALLBACK_COLOR = '#64748b';

// Team colors follow team order in the palette (tribe colors come with each castaway's tribe stints)
function assignColors(data) {
  data.teamColor = {};
  data.teamNames.forEach((t, i) => {
    data.teamColor[t] = data.teams[t].color = PALETTE[i % PALETTE.length];
  });
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Dark text on light fills, white text on dark fills
function contrastText(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#2b1d0e' : '#ffffff';
}

// A tribe stint's color
function tribeColor(stint) {
  return stint.tribeColor || FALLBACK_COLOR;
}

// A tribe stint's name in its color. Current tribe: solid fill. Former tribe: outline only, dimmed.
function tribeBadge(stint, faded = false) {
  const color = tribeColor(stint);
  const name = escapeHtml(stint.tribeName);
  if (faded) {
    return `<span class="badge badge-tribe" style="color:${color};background:transparent;border-color:${hexToRgba(color, 0.35)};opacity:0.7">${name}</span>`;
  }
  return `<span class="badge badge-tribe" style="color:${contrastText(color)};background:${color};border-color:${color}">${name}</span>`;
}

// A team name in its team color
function teamNameHtml(team) {
  return `<strong style="color:${appData.teamColor[team] || FALLBACK_COLOR}">${escapeHtml(team)}</strong>`;
}
