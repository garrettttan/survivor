// Backend: turns parsed sheet data into castaways, points and teams. No DOM, colors or browser state.

// Tribe changes put the new tribe in the Tribe column. Swap/switch rows name a castaway;
// a merge row has no contestant and moves everyone still in the game.
const SWAP_EVENT = 'tribe swap';
const SWITCH_EVENT = 'switched tribes'; // like a swap, but for one castaway mid-phase
const MERGE_EVENT = 'merge';
const PHASE_EVENTS = new Set([SWAP_EVENT, MERGE_EVENT]); // tribe changes that don't score points
const ELIMINATION_EVENTS = new Set(['voted out', 'medivacked', 'quit']);
const SAT_OUT_EVENT = 'sat out of challenge'; // excludes the castaway from the nearest tribe-wide row above it

function processEventData(rosterRows, draftRows, eventRows, teamPicks, scoringLookup) {
  const events = parseEvents(eventRows);
  const { castaways, lookupCastaways } = buildCastaways(rosterRows, parseDraftTeams(draftRows));
  const { scoredEvents, merged } = applyGameEvents(events, castaways, lookupCastaways);
  scoreEvents(scoredEvents, lookupCastaways, scoringLookup);

  const weekNums = [...new Set(scoredEvents.map(e => e.week))].sort((a, b) => a - b);
  const activeWeeks = weekNums.map(num => ({ num }));
  buildWeekPoints(castaways, weekNums);

  const { teamNames, teams } = buildTeams(castaways, teamPicks);
  buildTeamCumulativePoints(teams, teamNames, activeWeeks);
  const activeNames = buildActiveNames(castaways);

  return { castaways, teams, teamNames, activeWeeks, activeNames, merged };
}

// One castaway object per (castaway, drafting team); lookupCastaways finds them by full or first name
function buildCastaways(rosterRows, draftTeams) {
  const castaways = [];
  const castawayMap = new Map();
  const seenNames = new Set();
  function addToMap(key, c) {
    if (!castawayMap.has(key)) castawayMap.set(key, []);
    castawayMap.get(key).push(c);
  }

  const rHeaders = rosterRows[0].map(h => h.trim().toLowerCase());
  const rCol = name => rHeaders.indexOf(name.toLowerCase());
  const castawayCol = rCol('castaway');

  for (let r = 1; r < rosterRows.length; r++) {
    const row = rosterRows[r];
    const name = (row[castawayCol] || '').trim();
    if (!name || seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());

    // Later tribes come from swap/switch/merge rows in the Events sheet (applyGameEvents)
    const startingTribe = (row[rCol('starting tribe')] || '').trim();
    const tribes = startingTribe ? [{ field: 'Starting tribe', value: startingTribe, week: 0 }] : [];

    const teams = draftTeams.get(name.toLowerCase()) || [];
    if (!teams.length) teams.push('');

    const advantages = (row[rCol('advantages')] || '').trim();
    const usedAdvantages = (row[rCol('used advantages')] || '').trim();
    const shortName = (row[rCol('short name')] || '').trim(); // optional, e.g. "Thien An" or a nickname

    for (const team of teams) {
      const c = { name, shortName, team, tribes, eliminated: false, advantages, usedAdvantages, events: [], weekPoints: [], total: 0 };
      castaways.push(c);
      addToMap(name.toLowerCase(), c);
      const firstName = name.split(' ')[0].toLowerCase();
      if (firstName !== name.toLowerCase()) addToMap(firstName, c);
    }
  }

  const lookupCastaways = nameStr => castawayMap.get(nameStr.toLowerCase()) || [];
  return { castaways, lookupCastaways };
}

// Applies eliminations and tribe changes; returns the events that can score points
function applyGameEvents(events, castaways, lookupCastaways) {
  let merged = false;
  const scoredEvents = [];
  let lastTribeRow = null; // most recent tribe-wide row, for attaching sit-outs
  for (const e of events) {
    const eventLower = e.event.toLowerCase();
    if (lastTribeRow && lastTribeRow.event.week !== e.week) lastTribeRow = null;

    if (eventLower === MERGE_EVENT) {
      merged = true;
      // Everyone still in the game at this point in the sheet joins the merged tribe
      if (e.tribe) {
        new Set(castaways.filter(c => !c.eliminated).map(c => c.tribes))
          .forEach(tribes => tribes.push({ field: `Week ${e.week} merge`, value: e.tribe, week: e.week }));
      }
      continue;
    }

    if (ELIMINATION_EVENTS.has(eventLower)) {
      lookupCastaways(e.contestant).forEach(c => {
        c.eliminated = true;
        c.eliminatedWeek = e.week;
      });
    }

    // Team instances of a castaway share one tribes array, so add the change once per array
    if ((eventLower === SWAP_EVENT || eventLower === SWITCH_EVENT) && e.tribe) {
      const field = `Week ${e.week} ${eventLower === SWAP_EVENT ? 'swap' : 'switch'}`;
      new Set(lookupCastaways(e.contestant).map(c => c.tribes))
        .forEach(tribes => tribes.push({ field, value: e.tribe, week: e.week }));
    }
    if (PHASE_EVENTS.has(eventLower)) continue;

    // A row with a Tribe but no contestant (e.g. "Won tribe immunity") scores for everyone on that
    // tribe and still in the game at this point in the sheet, minus any sit-outs that follow it
    if (!e.contestant && e.tribe) {
      const members = new Set(castaways
        .filter(c => !c.eliminated && c.tribes[c.tribes.length - 1]?.value === e.tribe)
        .map(c => c.name));
      lastTribeRow = { event: e, members, satOut: new Set() };
      scoredEvents.push(lastTribeRow);
      continue;
    }

    // Sit-outs right after a tribe-wide row (in the same week) skip that row's points
    if (eventLower === SAT_OUT_EVENT && lastTribeRow) {
      lookupCastaways(e.contestant).forEach(c => lastTribeRow.satOut.add(c.name));
    }

    if (e.contestant) scoredEvents.push(e);
  }

  // Order each tribe history chronologically (stable, so same-week changes keep their sheet order)
  new Set(castaways.map(c => c.tribes)).forEach(tribes => tribes.sort((a, b) => a.week === b.week ? 0 : a.week - b.week));

  // Expand each tribe-wide row into one row per member who didn't sit out
  const expanded = scoredEvents.flatMap(e => !e.members ? [e]
    : [...e.members].filter(name => !e.satOut.has(name)).map(name => ({ ...e.event, contestant: name })));
  return { scoredEvents: expanded, merged };
}

// Adds each event's points to every team instance of its castaway
function scoreEvents(scoredEvents, lookupCastaways, scoringLookup) {
  for (const e of scoredEvents) {
    const pts = scoringLookup[e.event.toLowerCase()] ?? 0;
    lookupCastaways(e.contestant).forEach(c => {
      c.events.push({ week: e.week, event: e.event, points: pts, details: e.details, otherPlayer: e.otherPlayer });
      c.total += pts;
    });
  }
}

// c.weekPoints[i] is the castaway's points in weekNums[i], or null if they had no events that week
function buildWeekPoints(castaways, weekNums) {
  castaways.forEach(c => {
    c.weekPoints = weekNums.map(w => {
      const weekEvents = c.events.filter(e => e.week === w);
      if (weekEvents.length === 0) return null;
      return weekEvents.reduce((sum, e) => sum + e.points, 0);
    });
  });
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

function buildTeamCumulativePoints(teams, teamNames, activeWeeks) {
  teamNames.forEach(t => {
    let cum = 0;
    teams[t].cumulativePoints = activeWeeks.map((w, wi) => {
      teams[t].castaways.forEach(c => {
        if (c.weekPoints[wi] !== null) cum += c.weekPoints[wi];
      });
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
    processEventData, buildCastaways, applyGameEvents, scoreEvents,
    buildWeekPoints, buildTeams, buildTeamCumulativePoints, buildActiveNames,
  };
}
