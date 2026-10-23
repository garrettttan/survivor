// Backend: fetches the Supabase draft data and runs it through scoring.js.
// The frontend only calls loadSeason().

// This season's tribes, castaways (keyed by id, with their tribes, points and game log), the draft's teams
// (keyed by name, with member ids) and the scoring rules, from the get-draft-data edge function.
// Tribes become tribe → color and scoring (category → rules) becomes the list the scoring tab shows.
async function fetchDraftData(draftId) {
  const url = `${CONFIG.SUPABASE_URL}/functions/v1/get-draft-data?season=${CONFIG.SEASON}&draft_id=${draftId}`;
  const res = await fetch(url, { headers: { apikey: CONFIG.SUPABASE_ANON_KEY } }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok || body.error) {
    throw new Error(`HTTP ${res ? res.status : '—'} loading draft data${body.error ? `: ${body.error}` : ''}`);
  }
  const { tribes = [], castaways = {}, teams = {}, scoring = {} } = body;
  if (!Object.keys(castaways).length) throw new Error(`No castaways found for season ${CONFIG.SEASON}.`);

  return {
    tribeColorConfig: Object.fromEntries(tribes.map(t => [t.name, t.color])),
    castaways,
    teams,
    scoringRules: buildScoringRules(scoring),
  };
}

// [{ category, rules: [{ event, description, points }] }] in the server's category order, leaving out 0-point rules
function buildScoringRules(scoring) {
  return Object.entries(scoring)
    .map(([category, rules]) => ({
      category,
      rules: rules.filter(r => r.points !== 0).map(r => ({ event: r.name, description: r.description || '', points: r.points })),
    }))
    .filter(c => c.rules.length);
}

// Everything the frontend needs for one draft: scored castaways and teams, plus the scoring rules
async function loadSeason() {
  const { tribeColorConfig, castaways, teams, scoringRules } = await fetchDraftData(CONFIG.DRAFT_ID);
  return {
    data: processDraftData(castaways, teams),
    scoringRules,
    tribeColorConfig,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { fetchDraftData, buildScoringRules, loadSeason };
}
