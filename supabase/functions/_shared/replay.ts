// =====================================================================
// Types 
// =====================================================================

/**
 * One row of the events_readable view (or season_events_readable, which has no draft_id):
 * one thing that happened to one castaway.
 */
export interface EventRow {
  draft_id?: number;
  event_id: number;
  season: number;
  episode: number;
  seq: number;
  castaway_id: number;
  castaway_first_name: string;
  castaway_last_name: string;
  category: string;
  event: string;
  changes_tribe: boolean;
  ends_game: boolean;
  advantage_effect: "gain" | "lose" | null;
  advantage_id: number | null;
  advantage: string | null;
  tribe_id: number | null;
  tribe: string | null;
  tribe_color: string | null;
  other_castaway_id: number | null;
  other_castaway: string | null;
  details: string | null;
  quantity: number;
  points: number;
}

/** One row of the rosters_readable view: one castaway on one team. */
export interface RosterRow {
  draft_id: number;
  team_id: number;
  team: string;
  castaway_id: number;
  castaway: string;
}

/** One period a castaway spent on one tribe. */
export interface TribeStint {
  tribeName: string;
  tribeColor: string | null;     // null if the tribe has no color set
  startReason: string; 
  startEpisode: number;
  endEpisode: number | null;     // null = still on this tribe
  memberIds: Set<number>;        // everyone on the tribe with them during this stint
                                 // (a Set: convert to a list before sending as JSON)
}

/** One line of a castaway's event log. */
export interface LogRow {
  episode: number;
  name: string;
  points: number;
  otherCastawayId: number | null;
  details: string | null;
  tribe: string | null;
  advantage: string | null;
}

/** Everything we know about one castaway after the replay. */
export interface CastawayState {
  id: number;
  firstName: string;
  lastName: string;
  points: number;
  active: boolean;
  exitEpisode: number | null;
  finish: "winner" | "finalist" | null;  // once the season has a winner: them, and everyone else still in at the end
  tribes: TribeStint[];          // every stint, oldest first; the last one is the current tribe
  advantages: string[];          // advantages they currently hold
  expiredAdvantages: string[]; 
  pointsByEpisode: number[];     // index 0 = episode 1, index 1 = episode 2, ...
  log: LogRow[];                 // every event for this castaway, in order
}

// A castaway switching tribes on their own (not in a swap): always a tribe change by itself
const SWITCHED_TRIBES = "Switched tribes";

// The winner's row at the end of a season: once it's there, the season is finished
const SOLE_SURVIVOR = "Became Sole Survivor";

// Whether two back-to-back rows are part of the same swap: the same tribe-change event in the
// same episode. A switch next to a swap, or two switches in a row, stay separate moves.
function inSameBlock(a: EventRow, b: EventRow): boolean {
  return a.changes_tribe && b.changes_tribe && a.episode === b.episode &&
    a.event === b.event && a.event !== SWITCHED_TRIBES;
}

export function eventRowToLogRow(event: EventRow): LogRow {
  return {
    episode: event.episode,
    name: event.event,
    points: event.points,
    otherCastawayId: event.other_castaway_id,
    details: event.details,
    tribe: event.tribe,
    advantage: event.advantage,
  };
}

// =====================================================================
// Replay function  
// =====================================================================

/**
 * Walk through every event in order and build up the game state.
 * events must already be sorted by episode, then seq.
 * Returns castaway id → that castaway's state.
 */
export function replay(events: EventRow[], rosters: RosterRow[]): Map<number, CastawayState> {
  // Castaway id → that castaway's state.
  const castaways = new Map<number, CastawayState>();

  // Advantage name → id of the castaway holding it (null once played or expired).
  const advantageToHolder = new Map<string, number | null>();

  // Id of the castaway who became Sole Survivor (null until the season is finished).
  let winnerId: number | null = null;

  // The last event is from the latest episode (events are sorted), so this is
  // how many episodes there are so far.
  const episodeCount = events.length > 0 ? events[events.length - 1].episode : 0;

  // Helper: get a castaway's state, creating a blank one the first time we see them.
  const stateFor = (id: number, firstName: string, lastName: string): CastawayState => {
    let c = castaways.get(id);
    if (!c) {
      c = {
        id,
        firstName,
        lastName,
        points: 0,
        active: true,
        exitEpisode: null,
        finish: null,
        tribes: [],
        advantages: [],
        expiredAdvantages: [],
        pointsByEpisode: new Array<number>(episodeCount).fill(0),  // one 0 per episode
        log: [],
      };
      castaways.set(id, c);
    }
    return c;
  };

  // ---------------------------------------------------------------
  // Tribe tracking
  // ---------------------------------------------------------------

  // Tribe name → ids of everyone on it right now
  const tribeMembers = new Map<string, Set<number>>();

  // Castaway id → the stint they're in right now
  const currentStints = new Map<number, TribeStint>();

  // Remove a castaway from their current tribe (swap or exit).
  const leaveTribe = (castawayId: number, episode: number) => {
    const stint = currentStints.get(castawayId);
    if (!stint) return;                        // not on a tribe (e.g. Exile Island)
    tribeMembers.get(stint.tribeName)!.delete(castawayId);
    stint.endEpisode = episode;
    currentStints.delete(castawayId);
  };

  // Add a castaway to a tribe, starting a new stint, and record tribemates both ways.
  const joinTribe = (castaway: CastawayState, tribeName: string, tribeColor: string | null, episode: number, startReason: string) => {
    if (!tribeMembers.has(tribeName)) tribeMembers.set(tribeName, new Set());
    const currentMembers = tribeMembers.get(tribeName)!;

    const newStint: TribeStint = {
      tribeName,
      tribeColor,
      startReason,
      startEpisode: episode,
      endEpisode: null,
      // The newcomer's tribemates start as everyone already on the tribe...
      memberIds: new Set(currentMembers),                         
    };

    // Everyone in the new tribe gains the newcomer as a tribemate.
    for (const otherId of currentMembers) {
      currentStints.get(otherId)!.memberIds.add(castaway.id);
    }

    currentMembers.add(castaway.id);
    currentStints.set(castaway.id, newStint);
    castaway.tribes.push(newStint);               // keep every stint, in order
  };

  // ---------------------------------------------------------------
  // STEP 1: go through every event, oldest first, and apply it.
  // ---------------------------------------------------------------
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const c = stateFor(e.castaway_id, e.castaway_first_name, e.castaway_last_name);

    // Points: add to their total and to this episode's total.
    c.points += e.points;
    c.pointsByEpisode[e.episode - 1] += e.points;   // episode 1 is index 0

    // Add this event to the castaway's log (if it's not a tribe change event)
    if (!e.changes_tribe) {
      c.log.push(eventRowToLogRow(e));
    }

    // Tribe changes. A swap is many rows of the same tribe-change event in a row. Handle the
    // whole block at once, when we reach its FIRST row: everyone leaves their old tribe,
    // then everyone joins their new one. This stops people who swap early from
    // looking like they overlapped with people who left later in the same swap.
    const startsBlock = e.changes_tribe && !(i > 0 && inSameBlock(events[i - 1], e));

    if (startsBlock) {
      // Find where this block of tribe-change rows ends
      let end = i + 1;
      while (end < events.length && inSameBlock(events[end - 1], events[end])) end++;
      const block = events.slice(i, end);

      for (const b of block) leaveTribe(b.castaway_id, b.episode);
      for (const b of block) {
        if (!b.tribe) continue;
        const member = stateFor(b.castaway_id, b.castaway_first_name, b.castaway_last_name);
        joinTribe(member, b.tribe, b.tribe_color, b.episode, b.event);
      }
      // The other rows in the block still get their points and log entries
      // when the loop reaches them; their tribe change is already done.
    }

    // Exit (voted out, quit, medevac): mark them out and take them off their tribe.
    if (e.ends_game && c.active) {
      c.active = false;
      c.exitEpisode = e.episode;
      leaveTribe(c.id, e.episode);
    }

    if (e.event === SOLE_SURVIVOR) winnerId = c.id;

    // Advantages: "gain" makes this castaway the holder; "lose" means nobody holds it.
    if (e.advantage && e.advantage_effect === "gain") advantageToHolder.set(e.advantage, e.castaway_id);
    if (e.advantage && e.advantage_effect === "lose") {
      c.expiredAdvantages.push(e.advantage); 
      advantageToHolder.set(e.advantage, null);
    }
  }

  // ---------------------------------------------------------------
  // STEP 2: finishing touches
  // ---------------------------------------------------------------

  // Give each advantage to whoever holds it at the end.
  for (const [advantage, id] of advantageToHolder) {
    if (id !== null) castaways.get(id)?.advantages.push(advantage);
  }

  // Once someone has won, everyone else still in made the final tribal.
  if (winnerId !== null) {
    for (const c of castaways.values()) {
      if (c.id === winnerId) c.finish = "winner";
      else if (c.active) c.finish = "finalist";
    }
  }

  return castaways;
}
