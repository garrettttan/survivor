// Playing cards forward, for a new episode or an edit, without the database: index.ts loads and saves, this decides.
//
// An edit to an episode changes the game for every episode after it (a corrected swap changes who wins Toka's
// immunity next episode), so editing replays each later episode from its own cards, stored or rebuilt, against
// the edited game, and reports what that changes in each.

import type { EventRow } from "../_shared/replay.ts";
import { cardRows, toEventRow, type CardRow, type SeasonData } from "./cards.ts";
import { gameState, type GameState } from "./game.ts";
import { rebuildEpisode, type Fallback } from "./rebuild.ts";

// deno-lint-ignore no-explicit-any
export type Card = Record<string, any>;

export interface PageError { card?: number; message: string }

/** Name → id lookups for gameState */
export interface Lookups {
  tribeIdByName: Map<string, number>;
  advantageIdByName: Map<string, number>;
}

/** An episode's cards played in order: the rows they make, errors by card, and the game before each card */
export interface Played {
  rows: (CardRow & { card: number; seq: number })[];
  errors: PageError[];
  states: GameState[];                           // one more than cards: the last is the game after every card
}

/** A row as the page shows it: event type by name, advantage as an id (or a new one's name), and its points */
export interface PageRow {
  castawayId: number;
  eventType: string;
  otherCastawayId: number | null;
  advantage: number | string | null;
  tribeId: number | null;
  quantity: number;
  details: string | null;
  points: number;
}

/** What an episode's new rows change from its saved ones, compared as sets (seq aside) */
export interface Changes {
  added: PageRow[];
  removed: PageRow[];
}

/** An episode after the edited one, replayed from its own cards */
export interface LaterEpisode {
  episode: number;
  cards: Card[];
  played: Played;
  changes: Changes;
}

export interface EpisodeCards {
  cards: Card[];
  rebuilt: boolean;                              // no cards were stored, so they were rebuilt from the saved rows
  fallbacks: Fallback[];                         // rebuilt rows that became custom cards
}

/**
 * Plays the cards in order from the game `replayed` ends with, each against the game the cards before it make.
 * The rows they make are added to `replayed`, so a later episode can be played after them.
 */
export function playEpisode(cards: Card[], episode: number, data: SeasonData, lookups: Lookups, replayed: EventRow[]): Played {
  const played: Played = { rows: [], errors: [], states: [] };
  played.states.push(gameState(replayed, lookups.tribeIdByName, lookups.advantageIdByName));

  const cried = new Set<number>();               // crying counts once per castaway per episode
  cards.forEach((card, index) => {
    const { rows, errors } = cardRows(card, data, played.states[played.states.length - 1]);
    for (const row of rows.filter(r => r.eventType.name === "Cried on camera")) {
      if (cried.has(row.castawayId)) errors.push(`${data.castawayById.get(row.castawayId)?.name} already cried this episode.`);
      cried.add(row.castawayId);
    }
    if (errors.length) rows.length = 0;
    for (const message of errors) played.errors.push({ card: index, message });
    for (const row of rows) {
      const seq = played.rows.length + 1;
      played.rows.push({ ...row, card: index, seq });
      replayed.push(toEventRow(row, data, episode, seq));
    }
    played.states.push(gameState(replayed, lookups.tribeIdByName, lookups.advantageIdByName));
  });
  return played;
}

/**
 * An entered episode's cards: the stored ones, or rebuilt from its saved rows. `events` are the season's saved
 * rows, sorted by episode then seq; `stored` maps episode → stored cards.
 */
export function episodeCards(
  episode: number, events: EventRow[], stored: Map<number, Card[]>, data: SeasonData, lookups: Lookups,
): EpisodeCards {
  const cards = stored.get(episode);
  if (cards) return { cards: withAdvantageIds(cards, data), rebuilt: false, fallbacks: [] };
  const rebuilt = rebuildEpisode(events.filter(e => e.episode === episode), events.filter(e => e.episode < episode),
    data, lookups.tribeIdByName, lookups.advantageIdByName);
  return { cards: rebuilt.cards, rebuilt: true, fallbacks: rebuilt.fallbacks };
}

/**
 * An edit to `episode`: its new cards played from the saved game before it, then every later episode's own cards
 * played after them in turn. Each episode's changes compare its new rows with its saved ones.
 */
export function playEdit(
  episode: number, cards: Card[], events: EventRow[], stored: Map<number, Card[]>, data: SeasonData, lookups: Lookups,
): { played: Played; changes: Changes; later: LaterEpisode[] } {
  const replayed = events.filter(e => e.episode < episode);
  const played = playEpisode(cards, episode, data, lookups, replayed);
  const savedRows = (ep: number) => events.filter(e => e.episode === ep);

  const later: LaterEpisode[] = [];
  for (const ep of [...new Set(events.map(e => e.episode))].filter(ep => ep > episode).sort((a, b) => a - b)) {
    // Rebuilt from the game as it was saved, then played against the edited one
    const { cards: laterCards } = episodeCards(ep, events, stored, data, lookups);
    const laterPlayed = playEpisode(laterCards, ep, data, lookups, replayed);
    later.push({ episode: ep, cards: laterCards, played: laterPlayed, changes: rowChanges(laterPlayed.rows, savedRows(ep)) });
  }
  return { played, changes: rowChanges(played.rows, savedRows(episode)), later };
}

export function pageRow(r: CardRow): PageRow {
  return {
    castawayId: r.castawayId, eventType: r.eventType.name, otherCastawayId: r.otherCastawayId,
    advantage: r.advantageId ?? r.newAdvantage, tribeId: r.tribeId, quantity: r.quantity, details: r.details,
    points: r.eventType.points * r.quantity,
  };
}

function savedPageRow(e: EventRow): PageRow {
  return {
    castawayId: e.castaway_id, eventType: e.event, otherCastawayId: e.other_castaway_id, advantage: e.advantage_id,
    tribeId: e.tribe_id, quantity: Number(e.quantity ?? 1), details: e.details, points: Number(e.points),
  };
}

// Points aside, what makes a row the same row
const rowKey = (r: PageRow) =>
  JSON.stringify([r.castawayId, r.eventType, r.otherCastawayId, r.advantage, r.tribeId, r.quantity, r.details ?? null]);

/** The new rows not saved, and the saved rows not made again (a row made twice and saved once is added once) */
export function rowChanges(rows: CardRow[], saved: EventRow[]): Changes {
  const left = new Map<string, PageRow[]>();
  for (const s of saved.map(savedPageRow)) left.set(rowKey(s), [...(left.get(rowKey(s)) ?? []), s]);
  const added: PageRow[] = [];
  for (const r of rows.map(pageRow)) {
    const match = left.get(rowKey(r));
    if (match?.length) match.pop();
    else added.push(r);
  }
  return { added, removed: [...left.values()].flat() };
}

/**
 * Stored cards with each advantage named by id. A card that found a new advantage was stored with its name, and the
 * save created it; names are unique within a season, so the name now points at that advantage.
 */
function withAdvantageIds(cards: Card[], data: SeasonData): Card[] {
  const idByName = new Map([...data.advantageById.values()].map(a => [a.name, a.id]));
  return cards.map(card => typeof card.advantage === "string" && idByName.has(card.advantage.trim())
    ? { ...card, advantage: idByName.get(card.advantage.trim()) }
    : card);
}
