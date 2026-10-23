// Backend: links the draft data's castaways and teams by id and adds what the server doesn't send (names,
// team totals, the scored log). Fields keep the server's names. No DOM, colors or browser state.

// Held advantages come from castaway.advantages; played ones are still read from the log
const PLAYED_ADV_EVENTS = new Set(['played idol or advantage successfully', 'wasted idol or advantage']);
const GENERIC_ADV = 'Idol or advantage';

function processDraftData(rawCastaways, rawTeams) {
  const castaways = Object.values(rawCastaways);
  const byId = new Map(castaways.map(c => [c.id, c]));
  castaways.forEach(c => addCastawayFields(c, byId));

  const teamNames = Object.keys(rawTeams).sort();
  const teams = {};
  teamNames.forEach(name => {
    teams[name] = addTeamFields(name, rawTeams[name], byId);
    teams[name].members.forEach(c => c.teams.push(name));
  });

  // pointsByEpisode[i] is episode i + 1, so the episodes run 1..the longest list
  const episodeCount = Math.max(0, ...castaways.map(c => (c.pointsByEpisode || []).length));
  const merged = castaways.some(c => c.tribes.some(t => /merge/i.test(t.startReason)));

  return { castaways, teams, teamNames, episodeCount, merged };
}

// Adds name, teams (filled in by processDraftData), tribe members, the scored log and used advantages
function addCastawayFields(c, byId) {
  c.name = [c.firstName, c.lastName].filter(Boolean).join(' ');
  c.teams = [];
  c.tribes = c.tribes || [];
  c.tribes.forEach(t => { t.members = (t.memberIds || []).map(id => byId.get(id)).filter(Boolean); });

  const log = c.log || [];
  log.forEach(e => { e.otherCastaway = byId.get(e.otherCastawayId) || null; });
  // Log rows that only record a tribe change are named after the stint's startReason ("Starting tribe",
  // "Swapped tribes"); c.tribes already has them, so they stay out of the scored log
  const tribeEvents = new Set(c.tribes.map(t => (t.startReason || '').toLowerCase()));
  c.events = log.filter(e => !tribeEvents.has(e.name.toLowerCase()));
  c.usedAdvantages = log.filter(e => PLAYED_ADV_EVENTS.has(e.name.toLowerCase())).map(e => e.advantage || GENERIC_ADV);
}

// The server's team plus its members, winner pick, points and running points by episode
function addTeamFields(name, raw, byId) {
  const members = (raw.memberIds || []).map(id => byId.get(id)).filter(Boolean);
  let cum = 0;
  const cumulativePoints = (raw.scoreByEpisode || []).map(p => (cum += p));
  return {
    ...raw,
    name,
    members,
    winnerPick: byId.get(raw.winnerPickId) || null,
    points: cum,
    cumulativePoints,
    activeCount: members.filter(c => c.active).length,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { processDraftData, addCastawayFields, addTeamFields };
}
