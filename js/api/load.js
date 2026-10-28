// API: fetches the Supabase draft data and links it up with draft-data.js.
// The page only calls loadSeason() and fetchSeasons().

// GET a public edge function (path includes any query string); null if the request couldn't be made
function callFunction(path) {
  return fetch(`${CONFIG.SUPABASE_URL}/functions/v1/${path}`, { headers: { apikey: CONFIG.SUPABASE_ANON_KEY } })
    .catch(() => null);
}

// This season's castaways (keyed by id, with their tribe stints, points and game log), the draft's teams
// (keyed by name, with member ids, points and ranks), the scoring rules (category → rules), and the episode count
// and whether the season has merged or finished, from the get-draft-data edge function
async function fetchDraftData(season, draftId) {
  const res = await callFunction(`get-draft-data?season=${season}&draft_id=${draftId}`);
  const body = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok || body.error) {
    throw new Error(`HTTP ${res ? res.status : '—'} loading draft data${body.error ? `: ${body.error}` : ''}`);
  }
  const { castaways = {}, teams = {}, scoring = {}, episodeCount = 0, merged = false, finished = false } = body;
  if (!Object.keys(castaways).length) throw new Error(`No castaways found for season ${season}.`);
  return { castaways, teams, scoring, episodeCount, merged, finished };
}

// One season picker entry. draftId is get-draft-data's draft_id; a season without a logos/N.png shows its
// title as text.
function makeSeasonEntry(season, draftId) {
  return { season, draftId, title: `Season ${season}`, logo: `logos/${season}.png` };
}

function defaultSeason() {
  return makeSeasonEntry(CONFIG.DEFAULT_SEASON.season, CONFIG.DEFAULT_SEASON.draftId);
}

// Every draft from the get-drafts edge function as a season entry, newest season first (the first draft wins
// if a season has several). The default season is always included, and is all there is if the request fails.
async function fetchSeasons() {
  const res = await callFunction('get-drafts');
  const body = res && res.ok ? await res.json().catch(() => ({})) : {};
  const entries = [defaultSeason()];
  for (const { id, season } of body.data || []) {
    if (!entries.some(e => e.season === season)) entries.push(makeSeasonEntry(season, id));
  }
  return entries.sort((a, b) => b.season - a.season);
}

// Everything the page needs for one draft: linked castaways and teams, plus the scoring rules.
// `entry` is one of fetchSeasons()'s entries.
async function loadSeason(entry) {
  const draft = await fetchDraftData(entry.season, entry.draftId);
  return { data: processDraftData(draft), scoring: draft.scoring };
}

if (typeof module !== 'undefined') {
  module.exports = { fetchDraftData, defaultSeason, fetchSeasons, loadSeason };
}
