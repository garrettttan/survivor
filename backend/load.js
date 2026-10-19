// Backend: fetches the Google Sheets and Supabase draft data and runs them through parse.js and scoring.js.
// The frontend only calls loadSeason().

// Google Sheets CSV endpoint
function sheetUrl(spreadsheetId, sheetName) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

// A sheet's CSV rows. If it can't be fetched, a required sheet throws and an optional one returns null.
async function fetchSheet(spreadsheetId, sheetName, { required = true, label = `the "${sheetName}" sheet` } = {}) {
  const res = await fetch(sheetUrl(spreadsheetId, sheetName)).catch(() => null);
  if (!res || !res.ok) {
    if (!required) return null;
    throw new Error(`HTTP ${res ? res.status : '—'} — check that ${label} is publicly shared.`);
  }
  return parseCSV(await res.text());
}

// This season's tribes and castaways plus the draft's teams, from the get-draft-data edge function.
// Tribes become tribe → color; castaways become the roster buildCastaways expects; teams become
// [name, winner pick] pairs and a lowercased castaway name → teams map.
async function fetchDraftData(draftId) {
  const url = `${CONFIG.SUPABASE_URL}/functions/v1/get-draft-data?season=${CONFIG.SEASON}&draft_id=${draftId}`;
  const res = await fetch(url, { headers: { apikey: CONFIG.SUPABASE_ANON_KEY } }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok || body.error) {
    throw new Error(`HTTP ${res ? res.status : '—'} loading draft data${body.error ? `: ${body.error}` : ''}`);
  }
  const { tribes = [], castaways = [], teams = [] } = body;
  if (!castaways.length) throw new Error(`No castaways found for season ${CONFIG.SEASON}.`);

  return {
    tribeColorConfig: Object.fromEntries(tribes.map(t => [t.name, t.color])),
    roster: castaways.map(c => ({
      name: [c.first_name, c.last_name].filter(Boolean).join(' '),
      firstName: c.first_name,
      startingTribe: c.starting_tribe?.name,
    })),
    teamPicks: teams.map(t => [t.team_name, t.winner_pick || '']),
    draftTeams: buildDraftTeams(teams),
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

// Parse an optional sheet, falling back if it's missing or malformed
function parseOptional(rows, parse, fallback) {
  if (!rows) return fallback;
  try { return parse(rows); } catch (_) { return fallback; }
}

// Everything the frontend needs for one draft: scored castaways and teams, plus the scoring rules
async function loadSeason() {
  const [{ tribeColorConfig, roster, teamPicks, draftTeams }, eventRows, scoringRows] = await Promise.all([
    fetchDraftData(CONFIG.DRAFT_ID),
    fetchSheet(CONFIG.SHEET_ID, CONFIG.SHEETS.events),
    fetchSheet(CONFIG.SHEET_ID, CONFIG.SHEETS.scoring, { required: false }),
  ]);

  // Without a Scoring sheet every event scores 0
  const scoring = parseOptional(scoringRows, parseScoringRules, { lookup: {}, rules: [], hidden: new Set() });

  return {
    data: processEventData(roster, draftTeams, eventRows, teamPicks, scoring.lookup),
    scoringRules: scoring.rules,
    hiddenEvents: scoring.hidden,
    tribeColorConfig,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { sheetUrl, fetchSheet, fetchDraftData, loadSeason };
}
