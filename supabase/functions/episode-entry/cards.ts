// Cards → events rows, and the checks on them. A card is what the admin page sends for one thing that happened
// (its shapes are listed in frontend/admin-cards.js); a card can make several rows.
//
// Supported so far: Custom row and Advantage. The other card types are added in phases 4 and 5; until then they
// come back as an error on the card.

import type { EventRow } from "../_shared/replay.ts";
import type { GameState } from "./game.ts";

export interface Castaway { id: number; firstName: string; lastName: string; name: string }
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

const CARD_LABELS: Record<string, string> = {
  tribeChange: "Tribe change", challenge: "Challenge", tribal: "Tribal Council", advantage: "Advantage",
  exit: "Exit", moment: "Moment", ftc: "Final Tribal", custom: "Custom row",
};

type Result = { rows: CardRow[]; errors: string[] };

/** The rows a card makes, or why it can't make them. `game` is the game just before the card. */
export function cardRows(card: Card, data: SeasonData, game: GameState): Result {
  if (card?.type === "custom") return customRows(card, data);
  if (card?.type === "advantage") return advantageRows(card, data, game);
  const label = CARD_LABELS[card?.type];
  return { rows: [], errors: [label ? `${label} cards aren't supported yet.` : `Unknown card type "${card?.type}".`] };
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
  if (eventType?.changesTribe && tribeId === null) errors.push(`"${eventType.name}" needs a tribe.`);

  const quantity = card.quantity ?? 1;
  if (typeof quantity !== "number" || !(quantity > 0)) errors.push("Quantity must be a positive number.");

  if (errors.length) return { rows: [], errors };
  const details = typeof card.details === "string" && card.details.trim() ? card.details.trim() : null;
  return { rows: [row(castawayId!, eventType!, { otherCastawayId, advantageId, tribeId, quantity, details })], errors: [] };
}

function idOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
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
