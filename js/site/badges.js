// Site: team colors, and the small badges the standings, overview and castaway panel draw names with.

// Gives each team its color, following alphabetical team order through the palette (js/shared/colors.js).
// Tribe colors come from the server with each castaway's tribe stints.
function assignColors(data) {
  data.teamNames.forEach((t, i) => { data.teams[t].color = PALETTE[i % PALETTE.length]; });
}

// A team's color by name
function teamColor(team) {
  return appData.teams[team]?.color || FALLBACK_COLOR;
}

// A tribe stint's color
function tribeColor(stint) {
  return stint.tribeColor || FALLBACK_COLOR;
}

// A tribe stint's name in its color. Current tribe: solid fill. Former tribe (`faded`): outline only, dimmed.
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
  return `<strong style="color:${teamColor(team)}">${escapeHtml(team)}</strong>`;
}

// An idol or advantage's name as a badge; a used one is dimmed
function advantageBadge(name, used = false) {
  return `<span class="badge badge-adv${used ? ' adv-used' : ''}">${escapeHtml(name)}</span>`;
}
