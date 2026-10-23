// Backend: links the draft data's castaways and teams by id and adds the team totals. No DOM, colors or browser state.

// Held advantages come from castaway.advantages; played ones are still read from the log
const PLAYED_ADV_EVENTS = new Set(['played idol or advantage successfully', 'wasted idol or advantage']);
const GENERIC_ADV = 'Idol or advantage';

function processDraftData(rawCastaways, rawTeams) {
  const castaways = Object.values(rawCastaways).map(buildCastaway);
  const byId = new Map(castaways.map(c => [c.id, c]));
  linkCastaways(castaways, byId);

  const { teamNames, teams } = buildTeams(rawTeams, byId);
  teamNames.forEach(t => teams[t].castaways.forEach(c => c.teams.push(t)));

  // pointsByEpisode[i] is episode i + 1, so the episodes run 1..the longest list
  const episodeCount = Math.max(0, ...castaways.map(c => c.episodePoints.length));
  const episodes = Array.from({ length: episodeCount }, (_, i) => ({ num: i + 1 }));
  const merged = castaways.some(c => c.tribes.some(t => /merge/i.test(t.reason)));

  return { castaways, teams, teamNames, episodes, merged };
}

// One castaway; teams, tribemates and other castaways in the log are filled in by id afterwards
function buildCastaway(raw) {
  const firstName = (raw.firstName || '').trim();
  const log = raw.log || [];
  // Log rows that only record a tribe change are named after the stint's startReason ("Starting tribe",
  // "Swapped tribes"); tribes come from raw.tribes, so those rows stay out of the event log
  const tribeEvents = new Set((raw.tribes || []).map(t => (t.startReason || '').toLowerCase()));
  return {
    id: raw.id,
    name: [firstName, (raw.lastName || '').trim()].filter(Boolean).join(' '),
    shortName: firstName, // e.g. "Thien An", which the first word alone would cut off
    teams: [],
    tribes: (raw.tribes || []).map(t => ({
      name: t.tribeName,
      reason: t.startReason || '',
      startEpisode: t.startEpisode,
      memberIds: t.memberIds || [],
    })),
    events: log.filter(e => !tribeEvents.has(e.name.toLowerCase())).map(e => ({
      episode: e.episode,
      event: e.name,
      points: e.points,
      details: e.details || e.advantage || '', // the event log shows the idol/advantage where Details would go
      otherId: e.otherCastawayId ?? null,
    })),
    advantages: raw.advantages || [],
    usedAdvantages: log.filter(e => PLAYED_ADV_EVENTS.has(e.name.toLowerCase())).map(e => e.advantage || GENERIC_ADV),
    eliminated: raw.active === false,
    exitEpisode: raw.exitEpisode ?? undefined,
    total: raw.points || 0,
    episodePoints: raw.pointsByEpisode || [],
  };
}

// Swap ids for the castaways they name: each tribe's members and each event's other castaway
function linkCastaways(castaways, byId) {
  castaways.forEach(c => {
    c.tribes.forEach(t => { t.members = t.memberIds.map(id => byId.get(id)).filter(Boolean); });
    c.events.forEach(e => { e.other = byId.get(e.otherId) || null; });
  });
}

function buildTeams(rawTeams, byId) {
  const teamNames = Object.keys(rawTeams).sort();
  const teams = {};
  teamNames.forEach(name => {
    const raw = rawTeams[name];
    const castaways = (raw.memberIds || []).map(id => byId.get(id)).filter(Boolean);
    let cum = 0;
    const cumulativePoints = (raw.scoreByEpisode || []).map(p => (cum += p));
    teams[name] = {
      name,
      castaways,
      winnerPick: byId.get(raw.winnerPickId) || null,
      totalPoints: cum,
      cumulativePoints,
      activeCount: castaways.filter(c => !c.eliminated).length,
    };
  });
  return { teamNames, teams };
}

if (typeof module !== 'undefined') {
  module.exports = { processDraftData, buildCastaway, linkCastaways, buildTeams };
}
