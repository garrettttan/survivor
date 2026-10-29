// Cards → events rows, and the checks on them. A card is what the admin page sends for one thing that happened
// (its shapes are listed in js/admin/admin-cards.js); a card can make several rows.
//
// Rows follow how past seasons were recorded: team wins and sit-outs in a tribe challenge carry the tribe, votes point
// at who they voted for, the Voted out row follows the votes, and a swap gives a row to everyone placed (even someone who stays).

import type { EventRow } from "../_shared/replay.ts";
import type { GameState } from "./game.ts";

export interface Castaway { id: number; firstName: string; lastName: string; name: string; nickname: string | null }
export interface Tribe { id: number; name: string; color: string }
export interface EventType {
  id: number;
  category: string;
  name: string;
  changesTribe: boolean;
  endsGame: boolean;
  advantageEffect: "gain" | "lose" | null;
  points: number;                                // the season's default points; 0 when it has no scoring row
}
export interface Advantage { id: number; name: string }

/** What the card rules look things up in */
export interface SeasonData {
  season: number;
  castawayById: Map<number, Castaway>;
  tribeById: Map<number, Tribe>;
  eventTypeByName: Map<string, EventType>;
  advantageById: Map<number, Advantage>;
}

/** One events row a card makes, before it's numbered */
export interface CardRow {
  castawayId: number;
  eventType: EventType;
  otherCastawayId: number | null;
  advantageId: number | null;
  newAdvantage: string | null;                   // the name of an advantage first found this episode (not saved yet)
  tribeId: number | null;
  quantity: number;
  details: string | null;
}

// deno-lint-ignore no-explicit-any
type Card = Record<string, any>;

// The one tribe change that can have no tribe: someone who started the game without one (the database allows
// it too, in check_event_fields)
const STARTING_TRIBE = "Starting tribe";

type Result = { rows: CardRow[]; errors: string[] };

/** The rows a card makes, or why it can't make them. `game` is the game just before the card. */
export function cardRows(card: Card, data: SeasonData, game: GameState): Result {
  switch (card?.type) {
    case "tribeChange": return tribeChangeRows(card, data, game);
    case "challenge": return challengeRows(card, data, game);
    case "tribal": return tribalRows(card, data, game);
    case "advantage": return advantageRows(card, data, game);
    case "exit": return exitRows(card, data, game);
    case "moment": return momentRows(card, data, game);
    case "ftc": return ftcRows(card, data, game);
    case "custom": return customRows(card, data);
    default: return { rows: [], errors: [`Unknown card type "${card?.type}".`] };
  }
}

// ── Who's where ──────────────────────────────────────────────────────────────

// Castaways still in the game, in id order
function activeIds(data: SeasonData, game: GameState): number[] {
  return [...data.castawayById.keys()].filter(id => !game.out.includes(id));
}

function membersOf(tribeId: number, data: SeasonData, game: GameState): number[] {
  return activeIds(data, game).filter(id => game.tribeOf[id] === tribeId);
}

function tribeName(data: SeasonData, id: number): string {
  return data.tribeById.get(id)?.name ?? `tribe ${id}`;
}

// A tribe with someone still in the game on it, or an error saying why not
function tribeInPlay(value: unknown, label: string, data: SeasonData, game: GameState, errors: string[]): number | null {
  const id = idOrNull(value);
  if (id === null) errors.push(`Pick ${label}.`);
  else if (!data.tribeById.has(id)) errors.push("That tribe isn't in this season.");
  else if (!membersOf(id, data, game).length) errors.push(`No one still in the game is on ${tribeName(data, id)}.`);
  else return id;
  return null;
}

// A card's map of castaway id → value (JSON object keys are strings)
function entries(map: unknown): [number, unknown][] {
  if (!map || typeof map !== "object") return [];
  return Object.entries(map).map(([k, v]) => [Number(k), v]);
}

// ── Tribe change ─────────────────────────────────────────────────────────────
// Swap: everyone still in the game is placed on a tribe and gets a Swapped tribes row. Switched
// Tribes: one castaway's Switched tribes row. Merge: a Merged row for everyone still in the game.
// Start: a Starting tribe row for each castaway placed, none of whom is on a tribe yet. Starting tribes are loaded
// from a CSV before the season; this kind lets an episode with them be edited as cards. A null tribe means they
// started the game without one (someone who arrives later).
function tribeChangeRows(card: Card, data: SeasonData, game: GameState): Result {
  const errors: string[] = [];
  if (card.kind === "start") return startRows(card, data, game);
  if (card.kind === "move") {
    const id = activeCastaway(card.castawayId, "who switched", data, game, errors);
    const tribeId = idOrNull(card.tribeId);
    if (tribeId === null) errors.push("Pick their new tribe.");
    else if (!data.tribeById.has(tribeId)) errors.push("That tribe isn't in this season.");
    else if (id !== null && game.tribeOf[id] === tribeId) errors.push(`${name(data, id)} is already on ${tribeName(data, tribeId)}.`);
    const switched = eventType(data, "Switched tribes", errors);
    if (errors.length) return { rows: [], errors };
    return { rows: [row(id!, switched, { tribeId })], errors };
  }

  if (card.kind === "merge") {
    const tribeId = idOrNull(card.tribeId);
    if (tribeId === null) errors.push("Pick the merged tribe.");
    else if (!data.tribeById.has(tribeId)) errors.push("That tribe isn't in this season.");
    const merged = eventType(data, "Merged", errors);
    if (errors.length) return { rows: [], errors };
    return { rows: activeIds(data, game).map(id => row(id, merged, { tribeId })), errors };
  }

  if (card.kind !== "swap") return { rows: [], errors: ["Pick the kind of tribe change."] };
  const moves = entries(card.moves);
  const unplaced = activeIds(data, game).filter(id => !moves.some(([placed]) => placed === id));
  if (unplaced.length) {
    errors.push(`Everyone has to be on a tribe after a swap. Still to place: ${unplaced.map(id => name(data, id)).join(", ")}.`);
  }
  for (const [id, tribeId] of moves) {
    activeCastaway(id, "a castaway", data, game, errors);
    if (typeof tribeId !== "number" || !data.tribeById.has(tribeId)) errors.push(`Pick a tribe in this season for ${name(data, id)}.`);
  }
  const swapped = eventType(data, "Swapped tribes", errors);
  if (errors.length) return { rows: [], errors };
  // Tribe by tribe, as entered
  const tribeOrder = [...data.tribeById.keys()];
  moves.sort(([a, ta], [b, tb]) => tribeOrder.indexOf(ta as number) - tribeOrder.indexOf(tb as number) || a - b);
  return { rows: moves.map(([id, tribeId]) => row(id, swapped, { tribeId: tribeId as number })), errors };
}

function startRows(card: Card, data: SeasonData, game: GameState): Result {
  const errors: string[] = [];
  const moves = entries(card.moves);
  if (!moves.length) errors.push("Place at least one castaway.");
  for (const [id, tribeId] of moves) {
    const active = activeCastaway(id, "a castaway", data, game, errors);
    if (active !== null && game.tribeOf[active] !== undefined) {
      errors.push(`${name(data, active)} is already on ${tribeName(data, game.tribeOf[active])}.`);
    }
    if (tribeId !== null && (typeof tribeId !== "number" || !data.tribeById.has(tribeId))) {
      errors.push(`Pick a tribe in this season for ${name(data, id)}, or no tribe.`);
    }
  }
  const starting = eventType(data, STARTING_TRIBE, errors);
  if (errors.length) return { rows: [], errors };
  // Tribe by tribe, then anyone without one
  const tribeOrder = [...data.tribeById.keys()];
  const place = (t: unknown) => t === null ? tribeOrder.length : tribeOrder.indexOf(t as number);
  moves.sort(([a, ta], [b, tb]) => place(ta) - place(tb) || a - b);
  return { rows: moves.map(([id, tribeId]) => row(id, starting, { tribeId: tribeId as number | null })), errors };
}

// ── Challenge ────────────────────────────────────────────────────────────────
// Won immunity or reward for everyone on the winning tribe or team (or the individual winner), the 2nd place
// rows when three or more competed, Sat out rows (with the castaway's tribe only in a tribe challenge, since
// individual and team challenges aren't competed by tribe), and Brought on reward rows for an individual reward. A
// challenge for immunity and reward makes immunity rows only.
function challengeRows(card: Card, data: SeasonData, game: GameState): Result {
  const errors: string[] = [];
  if (!["immunity", "reward", "both"].includes(card.prize)) errors.push("Pick the prize.");
  if (!["tribe", "individual", "teams"].includes(card.format)) errors.push("Pick the format.");
  if (errors.length) return { rows: [], errors };
  const prize = card.prize === "reward" ? "reward" : "immunity";
  const rows: CardRow[] = [];

  const satOut: number[] = [];
  for (const id of Array.isArray(card.satOut) ? card.satOut : []) {
    const active = activeCastaway(id, "who sat out", data, game, errors);
    if (active !== null) satOut.push(active);
  }
  const won = (ids: number[], second: boolean, tribeId: number | null) => {
    const type = eventType(data, `Won ${card.format === "individual" ? "individual" : "team"} ${prize}${second ? " (2nd place)" : ""}`, errors);
    for (const id of ids) if (!satOut.includes(id)) rows.push(row(id, type, { tribeId }));
  };

  if (card.format === "individual") {
    const winner = activeCastaway(card.first, "the winner", data, game, errors);
    if (winner !== null && satOut.includes(winner)) errors.push(`${name(data, winner)} can't win and sit out.`);
    if (winner !== null) won([winner], false, null);
    if (card.prize !== "immunity") {
      const brought = eventType(data, "Brought on reward", errors);
      for (const id of Array.isArray(card.broughtOnReward) ? card.broughtOnReward : []) {
        const guest = activeCastaway(id, "who they brought", data, game, errors);
        if (guest !== null && guest === winner) errors.push("The winner can't bring themselves.");
        else if (guest !== null) rows.push(row(guest, brought));
      }
    }
  } else if (card.format === "tribe") {
    const tribesInPlay = new Set(activeIds(data, game).map(id => game.tribeOf[id]));
    const first = tribeInPlay(card.first, "the winning tribe", data, game, errors);
    if (first !== null) won(membersOf(first, data, game), false, first);
    if (card.second != null) {
      const second = tribeInPlay(card.second, "the 2nd place tribe", data, game, errors);
      if (tribesInPlay.size < 3) errors.push("2nd place only counts with three or more tribes.");
      else if (second !== null && second === first) errors.push("1st and 2nd place can't be the same tribe.");
      else if (second !== null) won(membersOf(second, data, game), true, second);
    }
  } else {
    const teamCount = card.teamCount;
    if (!Number.isInteger(teamCount) || teamCount < 2) errors.push("Pick how many teams there were.");
    const teams = entries(card.teams);
    for (const [id] of teams) activeCastaway(id, "a castaway", data, game, errors);
    // Everyone still in the game is on a team or sat out: anyone not put on a team sat out
    for (const id of activeIds(data, game)) {
      if (!satOut.includes(id) && !teams.some(([placed]) => placed === id)) satOut.push(id);
    }
    const team = (n: number) => teams.filter(([, t]) => t === n).map(([id]) => id);
    const first = idOrNull(card.first);
    if (first === null || first < 1 || first > teamCount) errors.push("Pick the winning team.");
    else if (!team(first).length) errors.push(`No one is on Team ${first}.`);
    else won(team(first), false, null);
    const second = idOrNull(card.second);
    if (second !== null) {
      if (teamCount < 3) errors.push("2nd place only counts with three or more teams.");
      else if (second === first) errors.push("1st and 2nd place can't be the same team.");
      else if (!team(second).length) errors.push(`No one is on Team ${second}.`);
      else won(team(second), true, null);
    }
  }

  const sat = eventType(data, "Sat out of challenge", errors);
  for (const id of satOut) {
    rows.push(row(id, sat, { tribeId: card.format === "tribe" ? game.tribeOf[id] ?? null : null }));
  }
  if (errors.length) return { rows: [], errors };
  return { rows, errors };
}

// ── Tribal Council ───────────────────────────────────────────────────────────
// A Voted correctly or incorrectly row per final-round vote (pointing at who they voted for; none for No vote),
// then Voted out for whoever went home. Rocks: just Went home on rocks, no vote rows. A deadlock consensus is
// recorded like a vote.
function tribalRows(card: Card, data: SeasonData, game: GameState): Result {
  const errors: string[] = [];
  const tribeId = tribeInPlay(card.tribeId, "the tribe at Tribal", data, game, errors);
  if (!["voted", "rocks", "consensus"].includes(card.outcome)) errors.push("Pick how it ended.");
  if (tribeId === null || errors.length) return { rows: [], errors };
  const attendees = membersOf(tribeId, data, game);
  const bootId = idOrNull(card.bootId);
  if (bootId === null) errors.push("Pick who went home.");
  else if (!attendees.includes(bootId)) errors.push(`${name(data, bootId)} wasn't at this Tribal.`);

  const rows: CardRow[] = [];
  if (card.outcome !== "rocks") {
    const correct = eventType(data, "Voted correctly", errors);
    const incorrect = eventType(data, "Voted incorrectly", errors);
    const votes = new Map(entries(card.votes));
    for (const voter of attendees) {
      const target = votes.get(voter);
      if (target === undefined || target === null) errors.push(`Pick who ${name(data, voter)} voted for, or No vote.`);
      else if (target === "none") continue;
      else if (typeof target !== "number" || !attendees.includes(target) || target === voter) {
        errors.push(`${name(data, voter)}'s vote has to be for someone else at this Tribal.`);
      } else if (bootId !== null) {
        rows.push(row(voter, target === bootId ? correct : incorrect, { otherCastawayId: target }));
      }
    }
  }
  const out = eventType(data, card.outcome === "rocks" ? "Went home on rocks" : "Voted out", errors);
  if (errors.length) return { rows: [], errors };
  rows.push(row(bootId!, out));
  return { rows, errors };
}

// ── Exit, moments, Final Tribal ──────────────────────────────────────────────
const EXITS: Record<string, string> = { medevac: "Medically evacuated", quit: "Quit", fire: "Lost fire-making" };

function exitRows(card: Card, data: SeasonData, game: GameState): Result {
  const errors: string[] = [];
  if (!EXITS[card.reason]) errors.push("Pick why they left.");
  const id = activeCastaway(card.castawayId, "who left", data, game, errors);
  const type = EXITS[card.reason] ? eventType(data, EXITS[card.reason], errors) : null;
  if (errors.length) return { rows: [], errors };
  return { rows: [row(id!, type!)], errors };
}

// An iconic moment carries what happened; crying is once per castaway per episode (checked across cards when
// the episode is previewed)
function momentRows(card: Card, data: SeasonData, game: GameState): Result {
  const errors: string[] = [];
  if (card.kind !== "iconic" && card.kind !== "cried") return { rows: [], errors: ["Pick the moment."] };
  const id = activeCastaway(card.castawayId, "the castaway", data, game, errors);
  const note = typeof card.note === "string" ? card.note.trim() : "";
  if (card.kind === "iconic" && !note) errors.push("Say what happened.");
  const type = eventType(data, card.kind === "iconic" ? "Had an iconic moment" : "Cried on camera", errors);
  if (errors.length) return { rows: [], errors };
  return { rows: [row(id!, type, { details: card.kind === "iconic" ? note : null })], errors };
}

// One Received a jury vote row per juror's vote, for the finalist (everyone still in the game), pointing at the
// juror (someone already out), then a Became Sole Survivor row for whoever got the most votes
function ftcRows(card: Card, data: SeasonData, game: GameState): Result {
  const errors: string[] = [];
  const votes = entries(card.votes).filter(([, finalist]) => finalist !== null && finalist !== undefined);
  if (!votes.length) errors.push("Enter the jury's votes.");
  const received = eventType(data, "Received a jury vote", errors);
  const won = eventType(data, "Became Sole Survivor", errors);
  const rows: CardRow[] = [];
  const tally = new Map<number, number>();
  for (const [juror, finalist] of votes) {
    if (!game.out.includes(juror)) errors.push(`${name(data, juror)} is still in the game, so isn't on the jury.`);
    else if (typeof finalist !== "number" || game.out.includes(finalist) || !data.castawayById.has(finalist)) {
      errors.push(`${name(data, juror)}'s vote has to be for a finalist.`);
    } else {
      rows.push(row(finalist, received, { otherCastawayId: juror }));
      tally.set(finalist, (tally.get(finalist) ?? 0) + 1);
    }
  }
  const most = Math.max(...tally.values());
  const leaders = [...tally].filter(([, count]) => count === most).map(([id]) => id);
  if (leaders.length > 1) errors.push("The jury vote is tied.");
  if (errors.length) return { rows: [], errors };
  return { rows: [...rows, row(leaders[0], won)], errors };
}

// A row with only the columns set that most card rows use
function row(castawayId: number, eventType: EventType, extra: Partial<CardRow> = {}): CardRow {
  return {
    castawayId, eventType, otherCastawayId: null, advantageId: null, newAdvantage: null, tribeId: null,
    quantity: 1, details: null, ...extra,
  };
}

// The season's event type by name; a missing one is a setup problem, reported on the card
function eventType(data: SeasonData, name: string, errors: string[]): EventType {
  const type = data.eventTypeByName.get(name);
  if (!type) errors.push(`This season has no "${name}" event type.`);
  return type!;
}

function name(data: SeasonData, id: number): string {
  return data.castawayById.get(id)?.name ?? `castaway ${id}`;
}

// A castaway still in the game, or an error saying why not
function activeCastaway(value: unknown, label: string, data: SeasonData, game: GameState, errors: string[]): number | null {
  const id = idOrNull(value);
  if (id === null) errors.push(`Pick ${label}.`);
  else if (!data.castawayById.has(id)) errors.push(`That castaway isn't in this season.`);
  else if (game.out.includes(id)) errors.push(`${name(data, id)} is already out of the game.`);
  else return id;
  return null;
}

// Advantage: found (an existing one nobody holds, or a new one by name), gave away (a Gave away row for the giver
// and a Received row for the recipient, each pointing at the other), played (successfully or wasted, plus Had
// played for them when played on someone else), or expired. An advantage is a number (advantages.id) or a string
// (the name of one first found this episode).
function advantageRows(card: Card, data: SeasonData, game: GameState): Result {
  const errors: string[] = [];
  const action = card.action;
  if (!["found", "gave", "played", "expired"].includes(action)) return { rows: [], errors: ["Pick what happened with the advantage."] };
  const holderId = activeCastaway(card.castawayId, "the castaway", data, game, errors);
  const advantage = card.advantage;
  const isNew = typeof advantage === "string" && advantage.trim() !== "";
  const advantageId = idOrNull(advantage);
  if (!isNew && advantageId === null) {
    errors.push(action === "found" ? "Pick the advantage, or name the new one." : "Pick the advantage.");
  }

  // Who holds it now: matched by id, or by name while it's new
  const holderOf = (): number | undefined => {
    for (const [id, list] of Object.entries(game.held)) {
      if (list.some(a => isNew ? a.id === null && a.name === advantage.trim() : a.id === advantageId)) return Number(id);
    }
  };
  const advantageName = isNew ? advantage.trim() : data.advantageById.get(advantageId!)?.name;
  const ref = { advantageId: isNew ? null : advantageId, newAdvantage: isNew ? advantage.trim() : null };

  if (action === "found") {
    if (isNew && [...data.advantageById.values()].some(a => a.name.toLowerCase() === advantage.trim().toLowerCase())) {
      errors.push(`This season already has an advantage named "${advantage.trim()}"; pick it from the list.`);
    } else if (!isNew && advantageId !== null && !data.advantageById.has(advantageId)) {
      errors.push("That advantage isn't in this season.");
    } else if ((isNew || advantageId !== null) && holderOf() !== undefined) {
      errors.push(`${name(data, holderOf()!)} already holds ${advantageName}.`);
    }
    const found = eventType(data, "Found advantage", errors);
    if (errors.length) return { rows: [], errors };
    return { rows: [row(holderId!, found, ref)], errors };
  }

  // Gave, played and expired: the castaway has to hold it
  if (holderId !== null && (isNew || advantageId !== null) && holderOf() !== holderId) {
    errors.push(`${name(data, holderId)} doesn't hold ${advantageName ?? "that advantage"}.`);
  }

  if (action === "gave") {
    const recipientId = activeCastaway(card.recipientId, "who they gave it to", data, game, errors);
    if (recipientId !== null && recipientId === holderId) errors.push("They can't give an advantage to themselves.");
    const gave = eventType(data, "Gave away advantage", errors);
    const received = eventType(data, "Received advantage", errors);
    if (errors.length) return { rows: [], errors };
    return {
      rows: [
        row(holderId!, gave, { ...ref, otherCastawayId: recipientId }),
        row(recipientId!, received, { ...ref, otherCastawayId: holderId }),
      ],
      errors,
    };
  }

  if (action === "played") {
    // No target: they played it for themselves (an extra vote, or an idol on themselves)
    const targetId = idOrNull(card.targetId);
    if (targetId !== null && targetId !== holderId) activeCastaway(targetId, "who it was played on", data, game, errors);
    const played = eventType(data, card.changedOutcome ? "Played advantage successfully" : "Wasted advantage", errors);
    const forThem = targetId !== null && targetId !== holderId ? eventType(data, "Had advantage played for them", errors) : null;
    if (errors.length) return { rows: [], errors };
    const rows = [row(holderId!, played, { ...ref, otherCastawayId: forThem ? targetId : null })];
    if (forThem) rows.push(row(targetId!, forThem, { ...ref, otherCastawayId: holderId }));
    return { rows, errors };
  }

  // expired
  const expired = eventType(data, "Advantage expired", errors);
  if (errors.length) return { rows: [], errors };
  return { rows: [row(holderId!, expired, ref)], errors };
}

// Custom row: exactly one events row, as filled in
function customRows(card: Card, data: SeasonData): Result {
  const errors: string[] = [];
  const eventType = data.eventTypeByName.get(card.eventType);
  if (!eventType) errors.push(card.eventType ? `Unknown event type "${card.eventType}".` : "Pick an event type.");

  const castawayId = idOrNull(card.castawayId);
  if (castawayId === null) errors.push("Pick a castaway.");
  else if (!data.castawayById.has(castawayId)) errors.push("That castaway isn't in this season.");

  const otherCastawayId = idOrNull(card.otherCastawayId);
  if (otherCastawayId !== null && !data.castawayById.has(otherCastawayId)) errors.push("The other castaway isn't in this season.");
  if (otherCastawayId !== null && otherCastawayId === castawayId) errors.push("The other castaway can't be the same castaway.");

  const advantageId = idOrNull(card.advantage);
  if (advantageId !== null && !data.advantageById.has(advantageId)) errors.push("That advantage isn't in this season.");
  if (eventType?.advantageEffect && advantageId === null) errors.push(`"${eventType.name}" needs an advantage.`);

  const tribeId = idOrNull(card.tribeId);
  if (tribeId !== null && !data.tribeById.has(tribeId)) errors.push("That tribe isn't in this season.");
  if (eventType?.changesTribe && eventType.name !== STARTING_TRIBE && tribeId === null) {
    errors.push(`"${eventType.name}" needs a tribe.`);
  }

  const quantity = card.quantity ?? 1;
  if (typeof quantity !== "number" || !(quantity > 0)) errors.push("Quantity must be a positive number.");

  if (errors.length) return { rows: [], errors };
  const details = typeof card.details === "string" && card.details.trim() ? card.details.trim() : null;
  return { rows: [row(castawayId!, eventType!, { otherCastawayId, advantageId, tribeId, quantity, details })], errors: [] };
}

function idOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * Why `episode` can't be entered (or edited), or null if it can. A new episode has to be the one after the last
 * entered, so a season has no gaps; an edit has to be to an entered episode.
 */
export function episodeProblem(episode: number, maxEpisode: number, editing = false): string | null {
  if (editing) return episode <= maxEpisode ? null : `Episode ${episode} isn't entered yet, so there's nothing to edit.`;
  if (episode <= maxEpisode) return `Episode ${episode} is already entered.`;
  if (episode > maxEpisode + 1) return `Enter episode ${maxEpisode + 1} first.`;
  return null;
}

/** A new row shaped like season_events_readable, so it can be replayed with the saved ones */
export function toEventRow(row: CardRow, data: SeasonData, episode: number, seq: number): EventRow {
  const castaway = data.castawayById.get(row.castawayId)!;
  const tribe = row.tribeId === null ? null : data.tribeById.get(row.tribeId)!;
  const other = row.otherCastawayId === null ? null : data.castawayById.get(row.otherCastawayId)!;
  return {
    event_id: -seq,                              // not saved yet
    season: data.season,
    episode,
    seq,
    castaway_id: row.castawayId,
    castaway_first_name: castaway.firstName,
    castaway_last_name: castaway.lastName,
    category: row.eventType.category,
    event: row.eventType.name,
    changes_tribe: row.eventType.changesTribe,
    ends_game: row.eventType.endsGame,
    advantage_effect: row.eventType.advantageEffect,
    advantage_id: row.advantageId,
    advantage: row.advantageId === null ? row.newAdvantage : data.advantageById.get(row.advantageId)!.name,
    tribe_id: row.tribeId,
    tribe: tribe?.name ?? null,
    tribe_color: tribe?.color ?? null,
    other_castaway_id: row.otherCastawayId,
    other_castaway: other?.name ?? null,
    details: row.details,
    quantity: row.quantity,
    points: row.eventType.points * row.quantity,
  };
}
