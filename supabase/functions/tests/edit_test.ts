// Tests for playing edits forward (episode-entry/edit.ts): against season 51, and a small made-up season.
//
//   deno test --allow-read=supabase/functions supabase/functions/tests/

import { assertEquals } from "jsr:@std/assert@1";
import type { EventRow } from "../_shared/replay.ts";
import type { EventType, SeasonData } from "../episode-entry/cards.ts";
import { episodeCards, playEdit, playEpisode, type Card, type Lookups } from "../episode-entry/edit.ts";
import { fixtureSeasons } from "./fixture-season.ts";

// ── Season 51: opening an episode and saving it unchanged changes nothing ────
const s51 = fixtureSeasons().find(s => s.data.season === 51)!;
const lookups51: Lookups = { tribeIdByName: s51.tribeIdByName, advantageIdByName: s51.advantageIdByName };

for (const episode of [...new Set(s51.events.map(e => e.episode))]) {
  Deno.test(`season 51: episode ${episode} saved as rebuilt changes nothing, here or later`, () => {
    const { cards } = episodeCards(episode, s51.events, new Map(), s51.data, lookups51);
    const edit = playEdit(episode, cards, s51.events, new Map(), s51.data, lookups51);
    assertEquals(edit.played.errors, []);
    assertEquals(edit.changes, { added: [], removed: [] });
    for (const later of edit.later) {
      assertEquals(later.played.errors, [], `episode ${later.episode}`);
      assertEquals(later.changes, { added: [], removed: [] }, `episode ${later.episode}`);
    }
    assertEquals(edit.later.map(l => l.episode), [...new Set(s51.events.map(e => e.episode))].filter(e => e > episode));
  });
}

// ── A made-up season: Red (Ann, Bea) and Blue (Cal, Dee) ─────────────────────
const NAMES = ["Ann", "Bea", "Cal", "Dee"];
const types = ["Starting tribe", "Won team immunity", "Sat out of challenge", "Voted correctly", "Voted incorrectly",
  "Voted out", "Found advantage"];
const data: SeasonData = {
  season: 97,
  castawayById: new Map(NAMES.map((n, i) => [i + 1, { id: i + 1, firstName: n, lastName: "X", name: n, nickname: null }])),
  tribeById: new Map([[10, { id: 10, name: "Red", color: "#b91c1c" }], [11, { id: 11, name: "Blue", color: "#0284c7" }]]),
  eventTypeByName: new Map(types.map((name, i): [string, EventType] => [name, {
    id: i + 1, category: "Test", name, changesTribe: name === "Starting tribe", endsGame: name === "Voted out",
    advantageEffect: name === "Found advantage" ? "gain" : null, points: 1,
  }])),
  advantageById: new Map([[100, { id: 100, name: "Idol" }]]),
};
const lookups: Lookups = { tribeIdByName: new Map([["Red", 10], ["Blue", 11]]), advantageIdByName: new Map([["Idol", 100]]) };

const start = (moves: Record<number, number>): Card => ({ type: "tribeChange", kind: "start", moves, castawayId: null, tribeId: null });
const redImmunity: Card = { type: "challenge", prize: "immunity", format: "tribe", first: 10, second: null, teamCount: 2,
  teams: {}, satOut: [], broughtOnReward: [] };

// The saved rows the episodes' cards make, played one after another
function saved(...episodes: Card[][]): EventRow[] {
  const events: EventRow[] = [];
  episodes.forEach((cards, i) => {
    const played = playEpisode(cards, i + 1, data, lookups, events);
    assertEquals(played.errors, []);
  });
  return events;
}
const who = (rows: { castawayId: number; eventType: string }[]) => rows.map(r => `${NAMES[r.castawayId - 1]} ${r.eventType}`);

Deno.test("an edit carries forward: a later challenge's winners follow the edited tribes", () => {
  const events = saved([start({ 1: 10, 2: 10, 3: 11, 4: 11 })], [redImmunity]);
  // Ann and Cal start on each other's tribe instead
  const edit = playEdit(1, [start({ 1: 11, 2: 10, 3: 10, 4: 11 })], events, new Map(), data, lookups);
  assertEquals(edit.played.errors, []);
  assertEquals(who(edit.changes.added).sort(), ["Ann Starting tribe", "Cal Starting tribe"]);
  assertEquals(who(edit.changes.removed).sort(), ["Ann Starting tribe", "Cal Starting tribe"]);
  // Red won immunity in episode 2: now Bea and Cal, not Ann and Bea
  const [ep2] = edit.later;
  assertEquals(ep2.played.errors, []);
  assertEquals(who(ep2.changes.added), ["Cal Won team immunity"]);
  assertEquals(who(ep2.changes.removed), ["Ann Won team immunity"]);
});

Deno.test("an edit that breaks a later Tribal says so, in that episode", () => {
  // Episode 2: Blue's Tribal, Cal and Dee voting each other out, Dee going home
  const tribal: Card = { type: "tribal", tribeId: 11, outcome: "voted", bootId: 4, votes: { 3: 4, 4: 3 } };
  const events = saved([start({ 1: 10, 2: 10, 3: 11, 4: 11 })], [tribal]);
  // Ann starts on Blue too, so she's at that Tribal with no vote
  const edit = playEdit(1, [start({ 1: 11, 2: 10, 3: 11, 4: 11 })], events, new Map(), data, lookups);
  assertEquals(edit.played.errors, []);
  assertEquals(edit.later[0].played.errors, [{ card: 0, message: "Pick who Ann voted for, or No vote." }]);
});

Deno.test("stored cards are used as stored, with a new advantage now named by its id", () => {
  const found: Card = { type: "advantage", action: "found", castawayId: 1, advantage: "Idol", recipientId: null,
    targetId: null, changedOutcome: false };
  const events = saved([start({ 1: 10, 2: 10, 3: 11, 4: 11 })], [{ ...found, advantage: 100 }]);
  const stored = new Map([[2, [found]]]);
  const cards = episodeCards(2, events, stored, data, lookups);
  assertEquals(cards.rebuilt, false);
  assertEquals(cards.cards, [{ ...found, advantage: 100 }]);
  // Without stored cards, the episode is rebuilt from its rows
  assertEquals(episodeCards(2, events, new Map(), data, lookups).rebuilt, true);
});
