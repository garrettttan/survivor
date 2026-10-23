// Backend: links the draft data's castaways and teams by id and adds what the server doesn't send (names,
// team totals, log links). Fields keep the server's names. No DOM, colors or browser state.

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

// Adds name, teams (filled in by processDraftData), tribe members and each log row's other castaway
function addCastawayFields(c, byId) {
  c.name = [c.firstName, c.lastName].filter(Boolean).join(' ');
  c.teams = [];
  c.tribes = c.tribes || [];
  c.tribes.forEach(t => { t.members = (t.memberIds || []).map(id => byId.get(id)).filter(Boolean); });

  c.log = c.log || [];
  c.log.forEach(e => { e.otherCastaway = byId.get(e.otherCastawayId) || null; });
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
