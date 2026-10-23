// Backend: turns the draft's roster and game log into castaways, points and teams. No DOM, colors or browser state.

// Log rows that only record a tribe change: they set the castaway's tribe history and stay out of the event log
const STARTING_TRIBE_EVENT = 'starting tribe';
const TRIBE_EVENTS = new Set([STARTING_TRIBE_EVENT, 'swapped tribe', 'merged']);

// Idol/advantage rows name the item in Advantage; a row without one shows as a generic badge
const GAINED_ADV_EVENTS = new Set(['found idol or advantage', 'received idol or advantage']);
const GAVE_ADV_EVENT = 'gave away idol or advantage';
const PLAYED_ADV_EVENTS = new Set(['played idol or advantage successfully', 'wasted idol or advantage']);
const GENERIC_ADV = 'Idol or advantage';

function processGameData(roster, draftTeams, game, teamPicks) {
  const castaways = buildCastaways(roster, draftTeams, game);
  const merged = castaways.some(c => c.tribes.some(t => t.field.endsWith('merge')));

  // pointsByEpisode[i] is episode i + 1, so the episodes run 1..the longest list
  const episodeCount = Math.max(0, ...castaways.map(c => c.episodePoints.length));
  const episodes = Array.from({ length: episodeCount }, (_, i) => ({ num: i + 1 }));
  castaways.forEach(c => { while (c.episodePoints.length < episodeCount) c.episodePoints.push(0); });

  const { teamNames, teams } = buildTeams(castaways, teamPicks);
  buildTeamCumulativePoints(teams, teamNames, episodes);
  const activeNames = buildActiveNames(castaways);

  return { castaways, teams, teamNames, episodes, activeNames, merged };
}

// One castaway object per (castaway, drafting team). Points and exits come from game[castaway id];
// tribes, advantages and the event log are read from its log.
function buildCastaways(roster, draftTeams, game) {
  const castaways = [];
  const seenNames = new Set();

  for (const entry of roster) {
    const name = (entry.name || '').trim();
    if (!name || seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());

    const g = game[entry.id] || {};
    const state = readGameLog(g.log || []);
    // Fall back to the roster's starting tribe when the log has no tribe rows yet
    if (!state.tribes.length && entry.startingTribe) {
      state.tribes.push({ field: 'Starting tribe', value: entry.startingTribe, episode: 0 });
    }
    const status = {
      eliminated: g.active === false,
      exitEpisode: g.exitEpisode ?? undefined,
      total: g.points || 0,
    };

    const teams = draftTeams.get(name.toLowerCase()) || [];
    if (!teams.length) teams.push('');

    // Team instances of a castaway share the same tribes, events, advantage and episode point arrays
    const episodePoints = [...(g.pointsByEpisode || [])];
    const shortName = (entry.firstName || '').trim(); // e.g. "Thien An", which the first word alone would cut off
    for (const team of teams) {
      castaways.push({ id: entry.id, name, shortName, team, ...state, ...status, episodePoints });
    }
  }
  return castaways;
}

// Tribe history, advantages and scored events from one castaway's game log
function readGameLog(log) {
  const tribes = [];
  const events = [];
  const advantages = [];
  const usedAdvantages = [];
  const removeAdvantage = item => {
    const i = advantages.findIndex(a => a.toLowerCase() === item.toLowerCase());
    if (i >= 0) advantages.splice(i, 1);
  };

  for (const e of log) {
    const eventLower = e.name.toLowerCase();
    const item = e.advantage || GENERIC_ADV;

    if (TRIBE_EVENTS.has(eventLower)) {
      if (!e.tribe) continue;
      tribes.push(eventLower === STARTING_TRIBE_EVENT
        ? { field: 'Starting tribe', value: e.tribe, episode: 0 }
        : { field: `Episode ${e.episode} ${eventLower === 'merged' ? 'merge' : 'swap'}`, value: e.tribe, episode: e.episode });
      continue;
    }

    if (GAINED_ADV_EVENTS.has(eventLower)) advantages.push(item);
    if (eventLower === GAVE_ADV_EVENT) removeAdvantage(item);
    if (PLAYED_ADV_EVENTS.has(eventLower)) {
      removeAdvantage(item);
      usedAdvantages.push(item);
    }

    events.push({
      episode: e.episode,
      event: e.name,
      points: e.points,
      details: e.details || e.advantage || '', // the event log shows the idol/advantage where Details would go
      otherPlayer: e.other_castaway || '',
    });
  }

  // Chronological, keeping log order within an episode
  tribes.sort((a, b) => a.episode - b.episode);
  return { tribes, events, advantages, usedAdvantages };
}

function buildTeams(castaways, seasonPicks) {
  const teamNames = [...new Set(castaways.map(c => c.team).filter(Boolean))].sort();

  const teams = {};
  teamNames.forEach(t => {
    teams[t] = { name: t, totalPoints: 0, activeCount: 0, castaways: [], survivorGuess: null };
  });
  castaways.forEach(c => {
    if (!teams[c.team]) return;
    teams[c.team].totalPoints += c.total;
    teams[c.team].castaways.push(c);
    if (!c.eliminated) teams[c.team].activeCount++;
  });

  seasonPicks.forEach(([tName, guess]) => {
    if (tName && guess && teams[tName]) teams[tName].survivorGuess = guess;
  });

  return { teamNames, teams };
}

function buildTeamCumulativePoints(teams, teamNames, episodes) {
  teamNames.forEach(t => {
    let cum = 0;
    teams[t].cumulativePoints = episodes.map((ep, i) => {
      teams[t].castaways.forEach(c => { cum += c.episodePoints[i]; });
      return cum;
    });
  });
}

function buildActiveNames(castaways) {
  const active = castaways.filter(c => !c.eliminated);
  return {
    has(guess) {
      const g = guess.trim().toLowerCase();
      return active.some(c => c.name.toLowerCase() === g || c.name.toLowerCase().startsWith(g + ' '));
    }
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    processGameData, buildCastaways, readGameLog,
    buildTeams, buildTeamCumulativePoints, buildActiveNames,
  };
}
