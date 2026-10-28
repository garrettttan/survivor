// Cards → events rows, and the checks on them. A card is what the admin page sends for one thing that happened
// (its shapes are listed in frontend/admin-cards.js); a card can make several rows.
//
// Phase 3 supports only the Custom row card. The other card types are added in phases 4 and 5; until then they
// come back as an error on the card.

import type { EventRow } from "../_shared/replay.ts";

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

/** The rows a card makes, or why it can't make them */
export function cardRows(card: Card, data: SeasonData): { rows: CardRow[]; errors: string[] } {
  if (card?.type === "custom") return customRows(card, data);
  const label = CARD_LABELS[card?.type];
  return { rows: [], errors: [label ? `${label} cards aren't supported yet.` : `Unknown card type "${card?.type}".`] };
}

// Custom row: exactly one events row, as filled in
function customRows(card: Card, data: SeasonData): { rows: CardRow[]; errors: string[] } {
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
  return {
    rows: [{ castawayId: castawayId!, eventType: eventType!, otherCastawayId, advantageId, tribeId, quantity, details }],
    errors: [],
  };
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
    advantage: row.advantageId === null ? null : data.advantageById.get(row.advantageId)!.name,
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
