// The game as the admin page sees it at a point in the season: who's on which tribe, who's out, and who holds
// which advantages. Built by replaying events rows with the shared replay.

import { replay, type EventRow } from "../_shared/replay.ts";

/** One advantage someone holds; id is null for one first found in an unsaved card */
export interface HeldAdvantage {
  id: number | null;
  name: string;
}

export interface GameState {
  tribeOf: Record<number, number>;               // castaway id → the tribe they're on (their last tribe, if out)
  out: number[];                                 // castaways who've left the game, in the order they left
  held: Record<number, HeldAdvantage[]>;         // castaway id → advantages they hold
}

/**
 * The game after `rows` (sorted by episode, then seq). Tribes and advantages are matched back to their ids by
 * name, which is unique within a season.
 */
export function gameState(
  rows: EventRow[],
  tribeIdByName: Map<string, number>,
  advantageIdByName: Map<string, number>,
): GameState {
  const castaways = replay(rows, []);
  const state: GameState = { tribeOf: {}, out: [], held: {} };

  for (const c of castaways.values()) {
    const lastStint = c.tribes[c.tribes.length - 1];
    const tribeId = lastStint && tribeIdByName.get(lastStint.tribeName);
    if (tribeId !== undefined) state.tribeOf[c.id] = tribeId;
    if (c.advantages.length) {
      state.held[c.id] = c.advantages.map(name => ({ id: advantageIdByName.get(name) ?? null, name }));
    }
  }

  // The replay knows who's out but not in what order, so take that from the rows
  for (const r of rows) {
    if (r.ends_game && !state.out.includes(r.castaway_id)) state.out.push(r.castaway_id);
  }
  return state;
}
