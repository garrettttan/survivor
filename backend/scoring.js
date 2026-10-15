// Backend: turns parsed sheet data into castaways, points and teams. No DOM, colors or browser state.

const MERGE_EVENT = 'merge';
const PHASE_EVENTS = new Set(['tribe swap', MERGE_EVENT]); // mark when the next roster tribe column takes effect
const ELIMINATION_EVENTS = new Set(['voted out', 'medivacked', 'quit']);
const SWITCH_EVENT = 'switched tribes'; // Details holds the new tribe

function processEventData(rosterRows, draftRows, eventRows, teamPicks, scoringLookup) {
  const events = parseEvents(eventRows);
  const { castaways, lookupCastaways } = buildCastaways(rosterRows, parseDraftTeams(draftRows), findPhaseWeeks(events));
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

// Weeks of "Tribe swap"/"Merge" rows, in order — the i-th one is when tribe column i+1 took effect
function findPhaseWeeks(events) {
  const weeks = [];
  const seen = new Set();
  events.forEach(e => {
    const eventLower = e.event.toLowerCase();
    const key = `${eventLower}|${e.week}`;
    if (!PHASE_EVENTS.has(eventLower) || seen.has(key)) return;
    seen.add(key);
    weeks.push(e.week);
  });
  return weeks.sort((a, b) => a - b);
}

// One castaway object per (castaway, drafting team); lookupCastaways finds them by full or first name
function buildCastaways(rosterRows, draftTeams, phaseWeeks) {
  const castaways = [];
  const castawayMap = new Map();
  const seenNames = new Set();
  function addToMap(key, c) {
    if (!castawayMap.has(key)) castawayMap.set(key, []);
    castawayMap.get(key).push(c);
  }

  const rHeaders = rosterRows[0].map(h => h.trim().toLowerCase());
  const rCol = name => rHeaders.indexOf(name.toLowerCase());

  // Tribe columns are the 3 after "Castaway"; their headers (e.g. "Starting tribe") are the labels.
  // Each gets the week it took effect (Infinity if its swap/merge row hasn't been entered yet).
  const castawayCol = rCol('castaway');
  const tribeCols = [1, 2, 3]
    .map(o => ({ field: (rosterRows[0][castawayCol + o] || '').trim(), idx: castawayCol + o }))
    .filter(t => t.field)
    .map((t, i) => ({ ...t, week: i === 0 ? 0 : (phaseWeeks[i - 1] ?? Infinity) }));

  for (let r = 1; r < rosterRows.length; r++) {
    const row = rosterRows[r];
    const name = (row[castawayCol] || '').trim();
    if (!name || seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());

    const tribes = tribeCols
      .map(({ field, idx, week }) => ({ field, value: (row[idx] || '').trim(), week }))
      .filter(t => t.value);

    const teams = draftTeams.get(name.toLowerCase()) || [];
    if (!teams.length) teams.push('');

    const advantages = (row[rCol('advantages')] || '').trim();
    const usedAdvantages = (row[rCol('used advantages')] || '').trim();

    for (const team of teams) {
      const c = { name, team, tribes, eliminated: false, advantages, usedAdvantages, events: [], weekPoints: [], total: 0 };
      castaways.push(c);
      addToMap(name.toLowerCase(), c);
      const firstName = name.split(' ')[0].toLowerCase();
      if (firstName !== name.toLowerCase()) addToMap(firstName, c);
    }
  }

  const lookupCastaways = nameStr => castawayMap.get(nameStr.toLowerCase()) || [];
  return { castaways, lookupCastaways };
}

// Applies eliminations and tribe switches; returns the events that can score points
function applyGameEvents(events, castaways, lookupCastaways) {
  let merged = false;
  const scoredEvents = [];
  for (const e of events) {
    const eventLower = e.event.toLowerCase();

    if (eventLower === MERGE_EVENT) merged = true;
    if (PHASE_EVENTS.has(eventLower)) continue;

    if (ELIMINATION_EVENTS.has(eventLower)) {
      lookupCastaways(e.contestant).forEach(c => {
        c.eliminated = true;
        c.eliminatedWeek = e.week;
      });
    }

    // Team instances of a castaway share one tribes array, so add the switch once per array
    if (eventLower === SWITCH_EVENT && e.details) {
      new Set(lookupCastaways(e.contestant).map(c => c.tribes))
        .forEach(tribes => tribes.push({ field: `Week ${e.week} switch`, value: e.details, week: e.week }));
    }

    if (e.contestant) scoredEvents.push(e);
  }

  // Order each tribe history chronologically (stable, so a same-week switch stays after the column entry)
  new Set(castaways.map(c => c.tribes)).forEach(tribes => tribes.sort((a, b) => a.week === b.week ? 0 : a.week - b.week));

  return { scoredEvents, merged };
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
    processEventData, findPhaseWeeks, buildCastaways, applyGameEvents, scoreEvents,
    buildWeekPoints, buildTeams, buildTeamCumulativePoints, buildActiveNames,
  };
}
