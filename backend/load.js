// Backend: fetches the Supabase draft data and runs it through scoring.js.
// The frontend only calls loadSeason().

// This season's tribes, castaways, game log and scoring rules plus the draft's teams, from the get-draft-data
// edge function. Tribes become tribe → color; castaways become the roster buildCastaways expects; teams become
// [name, winner pick] pairs and a lowercased castaway name → teams map; game (keyed by castaway id) passes through;
// scoring (category → rules) becomes the list the scoring tab shows.
async function fetchDraftData(draftId) {
  const url = `${CONFIG.SUPABASE_URL}/functions/v1/get-draft-data?season=${CONFIG.SEASON}&draft_id=${draftId}`;
  const res = await fetch(url, { headers: { apikey: CONFIG.SUPABASE_ANON_KEY } }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok || body.error) {
    throw new Error(`HTTP ${res ? res.status : '—'} loading draft data${body.error ? `: ${body.error}` : ''}`);
  }
  const { tribes = [], castaways = [], teams = [], game = {}, scoring = {} } = body;
  if (!castaways.length) throw new Error(`No castaways found for season ${CONFIG.SEASON}.`);

  return {
    tribeColorConfig: Object.fromEntries(tribes.map(t => [t.name, t.color])),
    roster: castaways.map(c => ({
      id: c.id,
      name: [c.first_name, c.last_name].filter(Boolean).join(' '),
      firstName: c.first_name,
      startingTribe: c.starting_tribe?.name,
    })),
    teamPicks: teams.map(t => [t.team_name, t.winner_pick || '']),
    draftTeams: buildDraftTeams(teams),
    game,
    scoringRules: buildScoringRules(scoring),
  };
}

// Lowercased castaway name → names of the teams that drafted them
function buildDraftTeams(teams) {
  const draftTeams = new Map();
  teams.forEach(({ team_name, castaways = [] }) => {
    castaways.forEach(castaway => {
      const name = castaway.toLowerCase();
      if (!draftTeams.has(name)) draftTeams.set(name, []);
      if (!draftTeams.get(name).includes(team_name)) draftTeams.get(name).push(team_name);
    });
  });
  return draftTeams;
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
  const { tribeColorConfig, roster, teamPicks, draftTeams, game, scoringRules } = await fetchDraftData(CONFIG.DRAFT_ID);
  return {
    data: processGameData(roster, draftTeams, game, teamPicks),
    scoringRules,
    tribeColorConfig,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { fetchDraftData, buildScoringRules, loadSeason };
}
