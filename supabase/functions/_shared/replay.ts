// The replay: plays a season's events rows in order and works out where every castaway stands. Everything the
// site shows about a castaway (points, tribes, advantages, how their game ended) comes from here, so the database
// only has to store what happened.
//
// Used by get-draft-data (the standings) and episode-entry (the game as the admin page sees it).

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
  seq: number;                                   // order within the episode, from 1
  castaway_id: number;
  castaway_first_name: string;
  castaway_last_name: string;
  category: string;
  event: string;                                 // the event type's name, e.g. "Voted out"
  changes_tribe: boolean;                        // the row moves the castaway to `tribe`
  ends_game: boolean;                            // the row takes the castaway out of the game
  advantage_effect: "gain" | "lose" | null;      // the castaway starts or stops holding `advantage`
  advantage_id: number | null;
  advantage: string | null;
  tribe_id: number | null;
  tribe: string | null;
  tribe_color: string | null;
  other_castaway_id: number | null;              // e.g. who they voted for
  other_castaway: string | null;
  details: string | null;
  quantity: number;
  points: number;                                // the event's points × quantity
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
  tribeColor: string | null;                     // null if the tribe has no color set
  startReason: string;                           // the tribe-change event that started it, e.g. "Merged"
  startEpisode: number;
  endEpisode: number | null;                     // null = still on this tribe
  memberIds: Set<number>;                        // everyone on the tribe with them during this stint
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
  active: boolean;                               // still in the game
  exitEpisode: number | null;                    // the episode they left in, null while active
  finish: "winner" | "finalist" | null;          // once the season has a winner: them, and everyone else still in
  tribes: TribeStint[];                          // every stint, oldest first; the last one is the current tribe
  advantages: string[];                          // advantages they hold at the end
  expiredAdvantages: string[];                   // advantages they played, gave away or let expire
  pointsByEpisode: number[];                     // index 0 = episode 1, index 1 = episode 2, ...
  log: LogRow[];                                 // every event for this castaway except tribe changes, in order
}

// =====================================================================
// Helpers
// =====================================================================

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

function eventRowToLogRow(event: EventRow): LogRow {
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
// Replay
// =====================================================================

/**
 * Walks through every event in order and builds up the game state.
 * `events` must already be sorted by episode, then seq.
 * Returns castaway id → that castaway's state.
 */
export function replay(events: EventRow[]): Map<number, CastawayState> {
  // Castaway id → that castaway's state
  const castaways = new Map<number, CastawayState>();

  // Advantage name → id of the castaway holding it (null once played or expired)
  const advantageToHolder = new Map<string, number | null>();

  // Id of the castaway who became Sole Survivor (null until the season is finished)
  let winnerId: number | null = null;

  // The last event is from the latest episode (events are sorted), so this is how many episodes there are so far
  const episodeCount = events.length > 0 ? events[events.length - 1].episode : 0;

  // A castaway's state, created blank the first time we see them
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
        pointsByEpisode: new Array<number>(episodeCount).fill(0),
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

  // Removes a castaway from their current tribe (a swap or an exit)
  const leaveTribe = (castawayId: number, episode: number) => {
    const stint = currentStints.get(castawayId);
    if (!stint) return;                          // not on a tribe (e.g. Exile Island)
    tribeMembers.get(stint.tribeName)!.delete(castawayId);
    stint.endEpisode = episode;
    currentStints.delete(castawayId);
  };

  // Adds a castaway to a tribe, starting a new stint, and records tribemates both ways
  const joinTribe = (
    castaway: CastawayState, tribeName: string, tribeColor: string | null, episode: number, startReason: string,
  ) => {
    if (!tribeMembers.has(tribeName)) tribeMembers.set(tribeName, new Set());
    const currentMembers = tribeMembers.get(tribeName)!;

    castaway.tribes.push({
      tribeName,
      tribeColor,
      startReason,
      startEpisode: episode,
      endEpisode: null,
      memberIds: new Set(currentMembers),        // the newcomer's tribemates: everyone already on the tribe
    });
    // ...and everyone already on the tribe gains the newcomer
    for (const otherId of currentMembers) currentStints.get(otherId)!.memberIds.add(castaway.id);

    currentMembers.add(castaway.id);
    currentStints.set(castaway.id, castaway.tribes[castaway.tribes.length - 1]);
  };

  // ---------------------------------------------------------------
  // Step 1: go through every event, oldest first, and apply it
  // ---------------------------------------------------------------
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const c = stateFor(e.castaway_id, e.castaway_first_name, e.castaway_last_name);

    // Points: add to their total and to this episode's total
    c.points += e.points;
    c.pointsByEpisode[e.episode - 1] += e.points;

    // Tribe changes show as tribe stints, not log rows
    if (!e.changes_tribe) c.log.push(eventRowToLogRow(e));

    // Tribe changes. A swap is many rows of the same tribe-change event in a row. Handle the whole block at once,
    // when we reach its FIRST row: everyone leaves their old tribe, then everyone joins their new one. This stops
    // people who swap early from looking like they overlapped with people who left later in the same swap.
    const startsBlock = e.changes_tribe && !(i > 0 && inSameBlock(events[i - 1], e));
    if (startsBlock) {
      let end = i + 1;
      while (end < events.length && inSameBlock(events[end - 1], events[end])) end++;
      const block = events.slice(i, end);

      for (const b of block) leaveTribe(b.castaway_id, b.episode);
      for (const b of block) {
        if (!b.tribe) continue;                  // started the game without a tribe
        const member = stateFor(b.castaway_id, b.castaway_first_name, b.castaway_last_name);
        joinTribe(member, b.tribe, b.tribe_color, b.episode, b.event);
      }
      // The other rows in the block still get their points when the loop reaches them; their move is done
    }

    // Exit (voted out, quit, medevac, ...): mark them out and take them off their tribe
    if (e.ends_game && c.active) {
      c.active = false;
      c.exitEpisode = e.episode;
      leaveTribe(c.id, e.episode);
    }

    if (e.event === SOLE_SURVIVOR) winnerId = c.id;

    // Advantages: "gain" makes this castaway the holder; "lose" means nobody holds it
    if (e.advantage && e.advantage_effect === "gain") advantageToHolder.set(e.advantage, e.castaway_id);
    if (e.advantage && e.advantage_effect === "lose") {
      c.expiredAdvantages.push(e.advantage);
      advantageToHolder.set(e.advantage, null);
    }
  }

  // ---------------------------------------------------------------
  // Step 2: finishing touches
  // ---------------------------------------------------------------

  // Give each advantage to whoever holds it at the end
  for (const [advantage, id] of advantageToHolder) {
    if (id !== null) castaways.get(id)?.advantages.push(advantage);
  }

  // Once someone has won, everyone else still in made the final tribal
  if (winnerId !== null) {
    for (const c of castaways.values()) {
      if (c.id === winnerId) c.finish = "winner";
      else if (c.active) c.finish = "finalist";
    }
  }

  return castaways;
}

/** A JSON.stringify replacer for the replay's results: Sets become arrays and Maps become objects. */
export function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) return [...value];
  if (value instanceof Map) return Object.fromEntries(value);
  return value;
}
