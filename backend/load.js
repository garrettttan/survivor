// Backend: fetches the Google Sheets and Supabase season data and runs them through parse.js and scoring.js.
// The frontend only calls loadDrafts() and loadSeason().

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

// This season's tribes and castaways, from the get-tribes-and-castaways edge function.
// Tribes become tribe → color; castaways become the roster buildCastaways expects.
async function fetchSeasonData() {
  const url = `${CONFIG.SUPABASE_URL}/functions/v1/get-tribes-and-castaways?season=${CONFIG.SEASON}`;
  const res = await fetch(url, { headers: { apikey: CONFIG.SUPABASE_ANON_KEY } }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok || body.error) {
    throw new Error(`HTTP ${res ? res.status : '—'} loading season data${body.error ? `: ${body.error}` : ''}`);
  }
  const { tribes = [], castaways = [] } = body;
  if (!castaways.length) throw new Error(`No castaways found for season ${CONFIG.SEASON}.`);

  return {
    tribeColorConfig: Object.fromEntries(tribes.map(t => [t.name, t.color])),
    roster: castaways.map(c => ({
      name: [c.first_name, c.last_name].filter(Boolean).join(' '),
      firstName: c.first_name,
      startingTribe: c.starting_tribe?.name,
    })),
  };
}

// Parse an optional sheet, falling back if it's missing or malformed
function parseOptional(rows, parse, fallback) {
  if (!rows) return fallback;
  try { return parse(rows); } catch (_) { return fallback; }
}

// Draft spreadsheets — listed in the Drafts sheet (columns: Draft name, Draft sheet URL)
async function loadDrafts() {
  const drafts = parseDrafts(await fetchSheet(CONFIG.SHEET_ID, CONFIG.SHEETS.drafts));
  if (!drafts.length) throw new Error(`No drafts found in the "${CONFIG.SHEETS.drafts}" sheet.`);
  return drafts;
}

// Everything the frontend needs for one draft: scored castaways and teams, plus the scoring rules
async function loadSeason(draftSheetId) {
  const [teamRows, draftRows, { tribeColorConfig, roster }, eventRows, scoringRows] = await Promise.all([
    fetchSheet(draftSheetId, CONFIG.DRAFT_SHEETS.teams, { required: false }),
    fetchSheet(draftSheetId, CONFIG.DRAFT_SHEETS.castaways, { label: `the draft's "${CONFIG.DRAFT_SHEETS.castaways}" sheet` }),
    fetchSeasonData(),
    fetchSheet(CONFIG.SHEET_ID, CONFIG.SHEETS.events),
    fetchSheet(CONFIG.SHEET_ID, CONFIG.SHEETS.scoring, { required: false }),
  ]);

  // Without a Scoring sheet every event scores 0
  const scoring = parseOptional(scoringRows, parseScoringRules, { lookup: {}, rules: [], hidden: new Set() });
  const teamPicks = parseOptional(teamRows, parseTeamPicks, []);

  return {
    data: processEventData(roster, draftRows, eventRows, teamPicks, scoring.lookup),
    scoringRules: scoring.rules,
    hiddenEvents: scoring.hidden,
    tribeColorConfig,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { sheetUrl, fetchSheet, fetchSeasonData, loadDrafts, loadSeason };
}
