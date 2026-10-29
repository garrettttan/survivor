// Saved rows → cards, for an entered episode with no stored cards: every episode entered before cards were kept,
// and episode 1 once its starting tribes are loaded from the CSV. This is cardRows run backwards.
//
// An episode's rows are read in seq order. The first row left decides what card it could be part of, and that card
// takes the rows it needs from what's left (a Gave away row and its Received row needn't be next to each other).
// The guess is then checked the only way that's certain: cardRows has to remake exactly those rows from the game as
// it stood. If it doesn't, the rows become custom cards, one per row, which always remake a row exactly. So the
// cards always remake the episode; the fallbacks say where they couldn't be real cards.

import type { EventRow } from "../_shared/replay.ts";
import { cardRows, type CardRow, type SeasonData } from "./cards.ts";
import { gameState, type GameState } from "./game.ts";

// deno-lint-ignore no-explicit-any
type Card = Record<string, any>;

/** A saved row that became a custom card, because no card remade it */
export interface Fallback {
  seq: number;
  castawayId: number;
  event: string;
}

export interface RebuiltEpisode {
  cards: Card[];
  fallbacks: Fallback[];
}

/**
 * The cards for one episode. `rows` are its saved rows and `before` the season's rows before it, both sorted by
 * episode then seq; tribes and advantages are matched to ids by name (gameState's lookups).
 */
export function rebuildEpisode(
  rows: EventRow[],
  before: EventRow[],
  data: SeasonData,
  tribeIdByName: Map<string, number>,
  advantageIdByName: Map<string, number>,
): RebuiltEpisode {
  const replayed = [...before];
  let remaining = [...rows];
  const result: RebuiltEpisode = { cards: [], fallbacks: [] };

  // The card's rows leave `remaining` and join the replay, in seq order
  const take = (taken: EventRow[]) => {
    remaining = remaining.filter(r => !taken.includes(r));
    replayed.push(...taken.sort((a, b) => a.seq - b.seq));
  };

  while (remaining.length) {
    const game = gameState(replayed, tribeIdByName, advantageIdByName);
    const guess = guessCard(remaining, data, game);
    const taken = guess?.rows ?? [remaining[0]];
    if (guess && remakes(guess.card, guess.rows, data, game)) {
      result.cards.push(guess.card);
    } else {
      for (const r of taken) {
        result.cards.push(customCard(r));
        result.fallbacks.push({ seq: r.seq, castawayId: r.castaway_id, event: r.event });
      }
    }
    take(taken);
  }
  return result;
}

/** Every episode's cards, keyed by episode. `events` are the season's saved rows, sorted by episode then seq. */
export function rebuildSeason(
  events: EventRow[],
  data: SeasonData,
  tribeIdByName: Map<string, number>,
  advantageIdByName: Map<string, number>,
): Map<number, RebuiltEpisode> {
  const episodes = new Map<number, RebuiltEpisode>();
  for (const episode of new Set(events.map(e => e.episode))) {
    const rows = events.filter(e => e.episode === episode);
    const before = events.filter(e => e.episode < episode);
    episodes.set(episode, rebuildEpisode(rows, before, data, tribeIdByName, advantageIdByName));
  }
  return episodes;
}

// ── Checking a guess ─────────────────────────────────────────────────────────

// What makes a row the same row, saved or about to be (seq aside)
function savedKey(r: EventRow): string {
  return JSON.stringify([r.castaway_id, r.event, r.other_castaway_id, r.advantage_id, r.tribe_id,
    Number(r.quantity ?? 1), r.details ?? null]);
}

function cardKey(r: CardRow): string {
  return JSON.stringify([r.castawayId, r.eventType.name, r.otherCastawayId, r.advantageId, r.tribeId,
    r.quantity, r.details]);
}

// Whether the card makes exactly these rows, in any order
function remakes(card: Card, rows: EventRow[], data: SeasonData, game: GameState): boolean {
  const made = cardRows(card, data, game);
  if (made.errors.length || made.rows.length !== rows.length) return false;
  const a = made.rows.map(cardKey).sort();
  const b = rows.map(savedKey).sort();
  return a.every((key, i) => key === b[i]);
}

// A custom card that makes exactly this row (shape as in js/admin/admin-cards.js)
function customCard(r: EventRow): Card {
  return {
    type: "custom", eventType: r.event, castawayId: r.castaway_id, otherCastawayId: r.other_castaway_id,
    advantage: r.advantage_id, tribeId: r.tribe_id, quantity: Number(r.quantity ?? 1), details: r.details ?? "",
  };
}

// ── Guessing ─────────────────────────────────────────────────────────────────
// Each guess is a card (every field the form has, as in admin-cards.js) and the saved rows it should remake.

type Guess = { card: Card; rows: EventRow[] } | null;

const EXITS: Record<string, string> = { "Medically evacuated": "medevac", "Quit": "quit", "Lost fire-making": "fire" };
const NOT_SAFE_SHOT = "Played Shot in the Dark (not safe)";
const SAFE_SHOT = "Safe from Shot in the Dark";
const VOTES = new Set(["Voted correctly", "Voted incorrectly", NOT_SAFE_SHOT, SAFE_SHOT]);
const WIN = /^Won (team|individual) (immunity|reward)( \(2nd place\))?$/;

function guessCard(remaining: EventRow[], data: SeasonData, game: GameState): Guess {
  const r = remaining[0];
  // The rows from the first one on, for as long as `test` holds
  const runOf = (test: (e: EventRow) => boolean) => {
    const run: EventRow[] = [];
    for (const e of remaining) {
      if (!test(e)) break;
      run.push(e);
    }
    return run;
  };
  const tribeChange = (fields: Card) => ({ type: "tribeChange", kind: "swap", moves: {}, castawayId: null, tribeId: null, ...fields });
  const advantage = (fields: Card) => ({ type: "advantage", action: "found", castawayId: r.castaway_id, advantage: r.advantage_id,
    recipientId: null, targetId: null, changedOutcome: false, ...fields });

  switch (r.event) {
    case "Starting tribe":
    case "Swapped tribes": {
      const run = runOf(e => e.event === r.event);
      const moves = Object.fromEntries(run.map(e => [e.castaway_id, e.tribe_id]));
      return { card: tribeChange({ kind: r.event === "Starting tribe" ? "start" : "swap", moves }), rows: run };
    }
    case "Switched tribes":
      return { card: tribeChange({ kind: "move", castawayId: r.castaway_id, tribeId: r.tribe_id }), rows: [r] };
    case "Merged":
      return { card: tribeChange({ kind: "merge", tribeId: r.tribe_id }), rows: runOf(e => e.event === "Merged") };

    case "Found advantage":
      return { card: advantage({ action: "found" }), rows: [r] };
    case "Advantage expired":
      return { card: advantage({ action: "expired" }), rows: [r] };
    case "Gave away advantage":
    case "Received advantage": {
      // The other half: the same advantage, between the same two castaways the other way round
      const giving = r.event === "Gave away advantage";
      const other = remaining.find(e => e.event === (giving ? "Received advantage" : "Gave away advantage") &&
        e.advantage_id === r.advantage_id && e.castaway_id === r.other_castaway_id && e.other_castaway_id === r.castaway_id);
      const [giver, recipient] = giving ? [r.castaway_id, r.other_castaway_id] : [r.other_castaway_id, r.castaway_id];
      return { card: advantage({ action: "gave", castawayId: giver, recipientId: recipient }), rows: other ? [r, other] : [r] };
    }
    case "Played advantage successfully":
    case "Wasted advantage": {
      // Played on someone else: they have a Had advantage played for them row pointing back
      const forThem = r.other_castaway_id === null ? undefined : remaining.find(e => e.event === "Had advantage played for them" &&
        e.advantage_id === r.advantage_id && e.castaway_id === r.other_castaway_id && e.other_castaway_id === r.castaway_id);
      return {
        card: advantage({ action: "played", targetId: r.other_castaway_id, changedOutcome: r.event === "Played advantage successfully" }),
        rows: forThem ? [r, forThem] : [r],
      };
    }

    case "Medically evacuated":
    case "Quit":
    case "Lost fire-making":
      return { card: { type: "exit", reason: EXITS[r.event], castawayId: r.castaway_id }, rows: [r] };
    case "Cried on camera":
      return { card: { type: "moment", kind: "cried", castawayId: r.castaway_id, note: "" }, rows: [r] };
    case "Had an iconic moment":
      return { card: { type: "moment", kind: "iconic", castawayId: r.castaway_id, note: r.details ?? "" }, rows: [r] };

    case "Received a jury vote": {
      const votes = runOf(e => e.event === "Received a jury vote");
      const winner = remaining[votes.length]?.event === "Became Sole Survivor" ? [remaining[votes.length]] : [];
      const card = { type: "ftc", votes: Object.fromEntries(votes.map(e => [e.other_castaway_id, e.castaway_id])) };
      return { card, rows: [...votes, ...winner] };
    }
  }

  if (VOTES.has(r.event)) return tribalGuess(runOf(e => VOTES.has(e.event)), remaining, data, game);
  if (WIN.test(r.event) || r.event === "Sat out of challenge" || r.event === "Brought on reward") {
    return challengeGuess(remaining);
  }
  return null;
}

// Votes, then whoever went home. Each castaway at Tribal (everyone on the boot's tribe) votes as their row says, or
// No vote if they have none: a consensus after a deadlock leaves the deadlocked pair without votes. Either Shot in the
// Dark row is a vote of "shot"; the safe one also marks them safe. Safety from immunity or an idol makes no row here,
// so a rebuilt Tribal doesn't have it. A Voted out row with no votes before it isn't guessed as a Tribal, since its
// votes were never recorded.
function tribalGuess(votes: EventRow[], remaining: EventRow[], data: SeasonData, game: GameState): Guess {
  const boot = remaining[votes.length];
  if (!boot || boot.event !== "Voted out") return null;
  const tribeId = game.tribeOf[boot.castaway_id];
  if (tribeId === undefined) return null;
  const attendees = [...data.castawayById.keys()].filter(id => !game.out.includes(id) && game.tribeOf[id] === tribeId);
  const cast = new Map(votes.map(e => [e.castaway_id, e.event === NOT_SAFE_SHOT || e.event === SAFE_SHOT ? "shot" : e.other_castaway_id]));
  const card = {
    type: "tribal", tribeId, outcome: "voted", bootId: boot.castaway_id,
    votes: Object.fromEntries(attendees.map(id => [id, cast.get(id) ?? "none"])),
    safe: Object.fromEntries(votes.filter(e => e.event === SAFE_SHOT).map(e => [e.castaway_id, "shot"])),
  };
  return { card, rows: [...votes, boot] };
}

// One challenge: its winners (a tribe, with an optional 2nd place tribe, or one castaway), who sat out, and who was
// brought on an individual reward, for as long as the rows are about the same challenge. Winners without a tribe
// in a team challenge (teams that aren't tribes) can't be guessed: who was on the losing team isn't saved.
function challengeGuess(remaining: EventRow[]): Guess {
  const rows: EventRow[] = [];
  let format: string | undefined, prize: string | undefined;
  let first: number | null | undefined, second: number | null | undefined;
  for (const e of remaining) {
    const win = e.event.match(WIN);
    if (win) {
      const [, f, p, place2] = win;
      if ((format && (f !== format || p !== prize)) || (f === "individual" && first !== undefined)) break;
      if (f === "team" && !place2 && first !== undefined && e.tribe_id !== first) break;
      if (f === "team" && place2 && second !== undefined && e.tribe_id !== second) break;
      format = f;
      prize = p;
      if (f === "individual") first = e.castaway_id;
      else if (place2) second = e.tribe_id;
      else first = e.tribe_id;
    } else if (e.event !== "Sat out of challenge" && e.event !== "Brought on reward") {
      break;
    }
    rows.push(e);
  }
  if (!format || first === undefined || first === null) return null;
  const card = {
    type: "challenge", prize, format: format === "team" ? "tribe" : "individual", first, second: second ?? null,
    teamCount: 2, teams: {},
    satOut: rows.filter(e => e.event === "Sat out of challenge").map(e => e.castaway_id),
    broughtOnReward: rows.filter(e => e.event === "Brought on reward").map(e => e.castaway_id),
  };
  return { card, rows };
}
