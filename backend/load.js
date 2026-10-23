// Backend: fetches the Supabase draft data and runs it through scoring.js.
// The frontend only calls loadSeason().

// This season's tribes, castaways (keyed by id, with their tribes, points and game log), the draft's teams
// (keyed by name, with member ids) and the scoring rules (category → rules), from the get-draft-data edge function
async function fetchDraftData(draftId) {
  const url = `${CONFIG.SUPABASE_URL}/functions/v1/get-draft-data?season=${CONFIG.SEASON}&draft_id=${draftId}`;
  const res = await fetch(url, { headers: { apikey: CONFIG.SUPABASE_ANON_KEY } }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok || body.error) {
    throw new Error(`HTTP ${res ? res.status : '—'} loading draft data${body.error ? `: ${body.error}` : ''}`);
  }
  const { tribes = [], castaways = {}, teams = {}, scoring = {} } = body;
  if (!Object.keys(castaways).length) throw new Error(`No castaways found for season ${CONFIG.SEASON}.`);
  return { tribes, castaways, teams, scoring };
}

// Everything the frontend needs for one draft: linked castaways and teams, plus the tribes and scoring rules
async function loadSeason() {
  const { tribes, castaways, teams, scoring } = await fetchDraftData(CONFIG.DRAFT_ID);
  return { data: processDraftData(castaways, teams), tribes, scoring };
}

if (typeof module !== 'undefined') {
  module.exports = { fetchDraftData, loadSeason };
}
