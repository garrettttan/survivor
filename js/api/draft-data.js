// API: links the draft data's castaways and teams by id and adds names. Everything else (points, ranks, who's
// active, how the season finished) comes from get-draft-data. Fields keep the server's names. No DOM, colors or
// browser state.

function processDraftData({ castaways: rawCastaways, teams: rawTeams, episodeCount, merged, finished }) {
  const castaways = Object.values(rawCastaways);
  const byId = new Map(castaways.map(c => [c.id, c]));
  castaways.forEach(c => addCastawayFields(c, byId));

  const teamNames = Object.keys(rawTeams).sort();
  const teams = {};
  teamNames.forEach(name => {
    teams[name] = addTeamFields(name, rawTeams[name], byId);
    teams[name].members.forEach(c => c.teams.push(name));
  });

  return { castaways, teams, teamNames, episodeCount, merged, finished };
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

// The server's team plus its name, members and winner pick
function addTeamFields(name, raw, byId) {
  return {
    ...raw,
    name,
    members: (raw.memberIds || []).map(id => byId.get(id)).filter(Boolean),
    winnerPick: byId.get(raw.winnerPickId) || null,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { processDraftData, addCastawayFields, addTeamFields };
}
