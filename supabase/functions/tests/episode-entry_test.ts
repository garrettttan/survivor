// Tests for episode-entry's game state and card rules (the parts that don't need a database).
//
//   deno test --allow-read=supabase/functions supabase/functions/tests/

import { assert, assertEquals } from "jsr:@std/assert@1";
import type { EventRow } from "../_shared/replay.ts";
import { cardRows, toEventRow, type EventType, type SeasonData } from "../episode-entry/cards.ts";
import { gameState, type GameState } from "../episode-entry/game.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);

// ── Game state, against the recorded replay of every real season ─────────────
for (const entry of Deno.readDirSync(FIXTURES)) {
  const match = entry.name.match(/^draft-(\d+)\.json$/);
  if (!match) continue;
  Deno.test(`draft ${match[1]}: the game state agrees with the replay`, async () => {
    const { events } = JSON.parse(await Deno.readTextFile(new URL(entry.name, FIXTURES))) as { events: EventRow[] };
    const expected = JSON.parse(await Deno.readTextFile(new URL(`draft-${match[1]}.expected.json`, FIXTURES)));
    const tribeIds = new Map(events.filter(e => e.tribe).map(e => [e.tribe!, e.tribe_id!]));
    const advantageIds = new Map(events.filter(e => e.advantage).map(e => [e.advantage!, e.advantage_id!]));

    const state = gameState(events, tribeIds, advantageIds);
    // deno-lint-ignore no-explicit-any
    const castaways = Object.values(expected) as any[];
    // Out: everyone the replay marks out, in the order their exit rows come
    const exits = events.filter(e => e.ends_game).map(e => e.castaway_id).filter((id, i, all) => all.indexOf(id) === i);
    assertEquals(state.out, exits);
    assertEquals([...state.out].sort(), castaways.filter(c => !c.active).map(c => c.id).sort());
    for (const c of castaways) {
      // Tribe: the last stint's tribe
      const last = c.tribes[c.tribes.length - 1];
      if (last) assertEquals(state.tribeOf[c.id], tribeIds.get(last.tribeName), `${c.firstName}'s tribe`);
      // Held advantages, with their ids
      assertEquals((state.held[c.id] ?? []).map(a => a.name), c.advantages, `${c.firstName}'s advantages`);
      for (const a of state.held[c.id] ?? []) assertEquals(a.id, advantageIds.get(a.name));
    }
  });
}

// ── Cards ────────────────────────────────────────────────────────────────────
function type(name: string, extra: Partial<EventType> = {}): EventType {
  return { id: name.length, category: "Test", name, changesTribe: false, endsGame: false, advantageEffect: null, points: 0, ...extra };
}

const data: SeasonData = {
  season: 99,
  castawayById: new Map([
    [1, { id: 1, firstName: "Ann", lastName: "Lee", name: "Ann Lee" }],
    [2, { id: 2, firstName: "Bea", lastName: "Ng", name: "Bea Ng" }],
    [3, { id: 3, firstName: "Cal", lastName: "Ito", name: "Cal Ito" }],
  ]),
  tribeById: new Map([[10, { id: 10, name: "Red", color: "#b91c1c" }]]),
  eventTypeByName: new Map([
    ["Cried on camera", type("Cried on camera", { points: -1 })],
    ["Found advantage", type("Found advantage", { advantageEffect: "gain", points: 2 })],
    ["Received advantage", type("Received advantage", { advantageEffect: "gain", points: 1 })],
    ["Gave away advantage", type("Gave away advantage", { advantageEffect: "lose" })],
    ["Played advantage successfully", type("Played advantage successfully", { advantageEffect: "lose", points: 2 })],
    ["Wasted advantage", type("Wasted advantage", { advantageEffect: "lose", points: -1 })],
    ["Had advantage played for them", type("Had advantage played for them", { points: 1 })],
    ["Advantage expired", type("Advantage expired", { advantageEffect: "lose" })],
    ["Voted out", type("Voted out", { endsGame: true })],
    ["Switched tribes", type("Switched tribes", { changesTribe: true })],
  ]),
  advantageById: new Map([[100, { id: 100, name: "Extra vote (Red)" }]]),
};

// Ann holds the extra vote; Cal is out
const game: GameState = { tribeOf: {}, out: [3], held: { 1: [{ id: 100, name: "Extra vote (Red)" }] } };

const custom = (fields: Record<string, unknown>) => ({ type: "custom", eventType: null, castawayId: null, otherCastawayId: null,
  advantage: null, tribeId: null, quantity: null, details: "", ...fields });

Deno.test("a filled-in custom row makes exactly that row", () => {
  const { rows, errors } = cardRows(custom({ eventType: "Cried on camera", castawayId: 1, details: "  at Tribal " }), data, game);
  assertEquals(errors, []);
  assertEquals(rows.length, 1);
  assertEquals([rows[0].castawayId, rows[0].eventType.name, rows[0].quantity, rows[0].details], [1, "Cried on camera", 1, "at Tribal"]);
});

Deno.test("a custom row says what's missing", () => {
  assertEquals(cardRows(custom({}), data, game).errors, ["Pick an event type.", "Pick a castaway."]);
  assertEquals(cardRows(custom({ eventType: "Found advantage", castawayId: 1 }), data, game).errors, ['"Found advantage" needs an advantage.']);
  assertEquals(cardRows(custom({ eventType: "Switched tribes", castawayId: 1 }), data, game).errors, ['"Switched tribes" needs a tribe.']);
  assertEquals(cardRows(custom({ eventType: "Cried on camera", castawayId: 1, otherCastawayId: 1 }), data, game).errors,
    ["The other castaway can't be the same castaway."]);
  assertEquals(cardRows(custom({ eventType: "Cried on camera", castawayId: 7 }), data, game).errors, ["That castaway isn't in this season."]);
});

Deno.test("other card types aren't supported yet", () => {
  assertEquals(cardRows({ type: "tribal" }, data, game).errors, ["Tribal Council cards aren't supported yet."]);
  assertEquals(cardRows({ type: "nope" }, data, game).errors, ['Unknown card type "nope".']);
});

Deno.test("a new row replays like a saved one, and changes the game", () => {
  const { rows } = cardRows(custom({ eventType: "Found advantage", castawayId: 2, advantage: 100, quantity: 2 }), data, game);
  const row = toEventRow(rows[0], data, 6, 1);
  assertEquals([row.advantage, row.advantage_effect, row.points, row.episode, row.seq], ["Extra vote (Red)", "gain", 4, 6, 1]);
  const state = gameState([row], new Map(), new Map([["Extra vote (Red)", 100]]));
  assertEquals(state.held[2], [{ id: 100, name: "Extra vote (Red)" }]);
  assert(!(1 in state.held));
});

// ── Advantage cards ──────────────────────────────────────────────────────────
const adv = (fields: Record<string, unknown>) => ({ type: "advantage", action: "found", castawayId: null, advantage: null,
  recipientId: null, targetId: null, changedOutcome: false, ...fields });
const summary = (r: ReturnType<typeof cardRows>) =>
  r.rows.map(x => [x.castawayId, x.eventType.name, x.otherCastawayId, x.advantageId ?? x.newAdvantage]);

Deno.test("giving an advantage away makes a Gave away row and a Received row", () => {
  const r = cardRows(adv({ action: "gave", castawayId: 1, advantage: 100, recipientId: 2 }), data, game);
  assertEquals(r.errors, []);
  assertEquals(summary(r), [
    [1, "Gave away advantage", 2, 100],
    [2, "Received advantage", 1, 100],
  ]);
  // Replayed, the advantage moves from Ann to Bea
  const after = gameState(r.rows.map((x, i) => toEventRow(x, data, 6, i + 1)),
    new Map(), new Map([["Extra vote (Red)", 100]]));
  assertEquals(after.held[2], [{ id: 100, name: "Extra vote (Red)" }]);
  assert(!(1 in after.held));
});

Deno.test("giving needs the giver to hold it and a recipient still in the game", () => {
  assertEquals(cardRows(adv({ action: "gave", castawayId: 2, advantage: 100, recipientId: 1 }), data, game).errors,
    ["Bea Ng doesn't hold Extra vote (Red)."]);
  assertEquals(cardRows(adv({ action: "gave", castawayId: 1, advantage: 100, recipientId: 3 }), data, game).errors,
    ["Cal Ito is already out of the game."]);
  assertEquals(cardRows(adv({ action: "gave", castawayId: 1, advantage: 100, recipientId: 1 }), data, game).errors,
    ["They can't give an advantage to themselves."]);
});

Deno.test("found: an unheld advantage, or a new one by name", () => {
  assertEquals(cardRows(adv({ castawayId: 2, advantage: 100 }), data, game).errors, ["Ann Lee already holds Extra vote (Red)."]);
  const r = cardRows(adv({ castawayId: 2, advantage: "  Idol (Blue) " }), data, game);
  assertEquals(summary(r), [[2, "Found advantage", null, "Idol (Blue)"]]);
  assertEquals(cardRows(adv({ castawayId: 2, advantage: "extra vote (red)" }), data, game).errors,
    ['This season already has an advantage named "extra vote (red)"; pick it from the list.']);
  assertEquals(cardRows(adv({ castawayId: 2 }), data, game).errors, ["Pick the advantage, or name the new one."]);
  // A new advantage found by an earlier card can be given away by name
  const held: GameState = { ...game, held: { 2: [{ id: null, name: "Idol (Blue)" }] } };
  assertEquals(summary(cardRows(adv({ action: "gave", castawayId: 2, advantage: "Idol (Blue)", recipientId: 1 }), data, held)),
    [[2, "Gave away advantage", 1, "Idol (Blue)"], [1, "Received advantage", 2, "Idol (Blue)"]]);
});

Deno.test("played: for themselves, or on someone else", () => {
  assertEquals(summary(cardRows(adv({ action: "played", castawayId: 1, advantage: 100, changedOutcome: false }), data, game)),
    [[1, "Wasted advantage", null, 100]]);
  assertEquals(summary(cardRows(adv({ action: "played", castawayId: 1, advantage: 100, targetId: 2, changedOutcome: true }), data, game)),
    [[1, "Played advantage successfully", 2, 100], [2, "Had advantage played for them", 1, 100]]);
});

Deno.test("expired", () => {
  assertEquals(summary(cardRows(adv({ action: "expired", castawayId: 1, advantage: 100 }), data, game)),
    [[1, "Advantage expired", null, 100]]);
});
