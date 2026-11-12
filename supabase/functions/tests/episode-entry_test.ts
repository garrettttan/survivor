// Tests for episode-entry's game state and card rules (the parts that don't need a database).
//
//   deno test --allow-read=supabase/functions supabase/functions/tests/

import { assert, assertEquals } from "jsr:@std/assert@1";
import type { EventRow } from "../_shared/replay.ts";
import { cardRows, episodeProblem, toEventRow, type SeasonData } from "../episode-entry/cards.ts";
import { gameState, type GameState } from "../episode-entry/game.ts";
import { rebuildEpisode } from "../episode-entry/rebuild.ts";
import { EVENT_TYPE as E } from "../_shared/event-types.ts";
import { testType as type, testTypes } from "./event-types.ts";
import { fixtureSeasons } from "./fixture-season.ts";

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

// ── Starting tribes, against every real season's CSV load ────────────────────
// The start card for an episode's Starting tribe rows makes those same rows (Lewis Kelly, who started season 51
// without a tribe, included)
for (const s of fixtureSeasons()) {
  Deno.test(`draft ${s.draftId}: a start card remakes the starting tribes`, () => {
    const loaded = s.events.filter(e => e.event_type_id === E.startingTribe);
    assert(loaded.length > 0);
    const card = { type: "tribeChange", kind: "start", moves: Object.fromEntries(loaded.map(e => [e.castaway_id, e.tribe_id])) };
    const { rows, errors } = cardRows(card, s.data, { tribeOf: {}, out: [], held: {} });
    assertEquals(errors, []);
    const key = (id: number, tribeId: number | null) => `${id}:${tribeId}`;
    assertEquals(rows.map(r => key(r.castawayId, r.tribeId)).sort(), loaded.map(e => key(e.castaway_id, e.tribe_id)).sort());
  });
}

// ── Cards ────────────────────────────────────────────────────────────────────
const data: SeasonData = {
  season: 99,
  castawayById: new Map([
    [1, { id: 1, firstName: "Ann", lastName: "Lee", name: "Ann Lee", nickname: null }],
    [2, { id: 2, firstName: "Bea", lastName: "Ng", name: "Bea Ng", nickname: null }],
    [3, { id: 3, firstName: "Cal", lastName: "Ito", name: "Cal Ito", nickname: null }],
  ]),
  tribeById: new Map([[10, { id: 10, name: "Red", color: "#b91c1c" }]]),
  eventTypeById: testTypes([
    type(E.criedOnCamera, { points: -1 }),
    type(E.foundAdvantage, { advantageEffect: "gain", points: 2 }),
    type(E.receivedAdvantage, { advantageEffect: "gain", points: 1 }),
    type(E.gaveAwayAdvantage, { advantageEffect: "lose" }),
    type(E.playedAdvantageSuccessfully, { advantageEffect: "lose", points: 2 }),
    type(E.wastedAdvantage, { advantageEffect: "lose", points: -1 }),
    type(E.hadAdvantagePlayedForThem, { points: 1 }),
    type(E.advantageExpired, { advantageEffect: "lose" }),
    type(E.votedOut),
    type(E.switchedTribes),
  ]),
  advantageById: new Map([[100, { id: 100, name: "Extra vote (Red)" }]]),
};

// Ann holds the extra vote; Cal is out
const game: GameState = { tribeOf: {}, out: [3], held: { 1: [{ id: 100, name: "Extra vote (Red)" }] } };

const custom = (fields: Record<string, unknown>) => ({ type: "custom", eventTypeId: null, castawayId: null, otherCastawayId: null,
  advantage: null, tribeId: null, quantity: null, details: "", ...fields });

Deno.test("a filled-in custom row makes exactly that row", () => {
  const { rows, errors } = cardRows(custom({ eventTypeId: E.criedOnCamera, castawayId: 1, details: "  at Tribal " }), data, game);
  assertEquals(errors, []);
  assertEquals(rows.length, 1);
  assertEquals([rows[0].castawayId, rows[0].eventType.name, rows[0].quantity, rows[0].details], [1, "Cried on camera", 1, "at Tribal"]);
});

Deno.test("a custom row says what's missing", () => {
  assertEquals(cardRows(custom({}), data, game).errors, ["Pick an event type.", "Pick a castaway."]);
  assertEquals(cardRows(custom({ eventTypeId: E.foundAdvantage, castawayId: 1 }), data, game).errors, ['"Found advantage" needs an advantage.']);
  assertEquals(cardRows(custom({ eventTypeId: E.switchedTribes, castawayId: 1 }), data, game).errors, ['"Switched tribes" needs a tribe.']);
  assertEquals(cardRows(custom({ eventTypeId: E.criedOnCamera, castawayId: 1, otherCastawayId: 1 }), data, game).errors,
    ["The other castaway can't be the same castaway."]);
  assertEquals(cardRows(custom({ eventTypeId: E.criedOnCamera, castawayId: 7 }), data, game).errors, ["That castaway isn't in this season."]);
});

Deno.test("event types are found by id, so renaming one changes nothing", () => {
  const renamed: SeasonData = { ...big, eventTypeById: new Map([...big.eventTypeById].map(([id, t]) => [id, { ...t, name: `Renamed ${id}` }])) };
  const card = { type: "tribal", tribeId: 10, outcome: "voted", bootId: 2, votes: { 1: "shot", 2: 1 }, safe: { 1: "shot" } };
  const { rows, errors } = cardRows(card, renamed, g);
  assertEquals(errors, []);
  assertEquals(rows.map(r => [r.castawayId, r.eventType.id]),
    [[1, E.shotSafe], [2, E.votedIncorrectly], [1, E.receivedNullifiedVote], [2, E.votedOut]]);
});

Deno.test("an unknown card type is an error", () => {
  assertEquals(cardRows({ type: "nope" }, data, game).errors, ['Unknown card type "nope".']);
});

Deno.test("a new row replays like a saved one, and changes the game", () => {
  const { rows } = cardRows(custom({ eventTypeId: E.foundAdvantage, castawayId: 2, advantage: 100, quantity: 2 }), data, game);
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

// ── The other cards ──────────────────────────────────────────────────────────
// Three tribes: Red (Ann, Bea), Blue (Cal, Dee), Green (Eve, Fay); Gus and Hal are out (Hal left last)
const NAMES = ["Ann", "Bea", "Cal", "Dee", "Eve", "Fay", "Gus", "Hal"];
const big: SeasonData = {
  season: 98,
  castawayById: new Map(NAMES.map((n, i) => [i + 1, { id: i + 1, firstName: n, lastName: "X", name: n, nickname: null }])),
  tribeById: new Map([[10, { id: 10, name: "Red", color: "#b91c1c" }], [11, { id: 11, name: "Blue", color: "#0284c7" }],
    [12, { id: 12, name: "Green", color: "#16a34a" }], [13, { id: 13, name: "Merged", color: "#7c3aed" }]]),
  eventTypeById: testTypes(Object.values(E).filter(id => id !== E.episodePoints).map(id => type(id))),
  advantageById: new Map(),
};
const g: GameState = { tribeOf: { 1: 10, 2: 10, 3: 11, 4: 11, 5: 12, 6: 12, 7: 12, 8: 11 }, out: [7, 8], held: {} };
const rowsOf = (card: Record<string, unknown>, game = g) => {
  const r = cardRows(card, big, game);
  assertEquals(r.errors, []);
  // Each row as [castaway, event, its tribe id or the other castaway's name]
  return r.rows.map(x => [NAMES[x.castawayId - 1], x.eventType.name,
    x.tribeId ?? (x.otherCastawayId === null ? null : NAMES[x.otherCastawayId - 1])]);
};
const errorsOf = (card: Record<string, unknown>) => cardRows(card, big, g).errors;

Deno.test("tribe change: swap, switch and merge", () => {
  // Everyone is placed: Ann and Cal trade tribes, the rest are placed on the tribe they were on, and all get a row
  assertEquals(rowsOf({ type: "tribeChange", kind: "swap", moves: { 3: 10, 1: 11, 2: 10, 4: 11, 5: 12, 6: 12 } }), [
    ["Bea", "Swapped tribes", 10], ["Cal", "Swapped tribes", 10], ["Ann", "Swapped tribes", 11],
    ["Dee", "Swapped tribes", 11], ["Eve", "Swapped tribes", 12], ["Fay", "Swapped tribes", 12],
  ]);
  assertEquals(errorsOf({ type: "tribeChange", kind: "swap", moves: { 3: 10, 1: 11 } }),
    ["Everyone has to be on a tribe after a swap. Still to place: Bea, Dee, Eve, Fay."]);
  assertEquals(rowsOf({ type: "tribeChange", kind: "move", castawayId: 1, tribeId: 12 }), [["Ann", "Switched tribes", 12]]);
  assertEquals(errorsOf({ type: "tribeChange", kind: "move", castawayId: 1, tribeId: 10 }), ["Ann is already on Red."]);
  assertEquals(rowsOf({ type: "tribeChange", kind: "merge", tribeId: 13 }).length, 6);
  assertEquals(errorsOf({ type: "tribeChange", kind: "swap", moves: { 1: 10, 2: 10, 3: 11, 4: 11, 5: 12, 6: 12, 7: 10 } }),
    ["Gus is already out of the game."]);
});

Deno.test("tribe change: starting tribes, including someone who starts without one", () => {
  const start: GameState = { tribeOf: {}, out: [], held: {} };
  const card = { type: "tribeChange", kind: "start", moves: { 3: null, 2: 11, 1: 10, 4: 10 } };
  // Tribe by tribe, then anyone without one
  assertEquals(rowsOf(card, start), [
    ["Ann", "Starting tribe", 10], ["Dee", "Starting tribe", 10], ["Bea", "Starting tribe", 11], ["Cal", "Starting tribe", null],
  ]);
  // Replayed, everyone placed is on their tribe, and Cal is in the game on none
  const after = gameState(cardRows(card, big, start).rows.map((x, i) => toEventRow(x, big, 1, i + 1)),
    new Map([["Red", 10], ["Blue", 11]]), new Map());
  assertEquals(after.tribeOf, { 1: 10, 2: 11, 4: 10 });
  assertEquals(after.out, []);
});

Deno.test("tribe change: starting tribes are only for castaways not on a tribe yet", () => {
  assertEquals(errorsOf({ type: "tribeChange", kind: "start", moves: {} }), ["Place at least one castaway."]);
  assertEquals(errorsOf({ type: "tribeChange", kind: "start", moves: { 1: 11 } }), ["Ann is already on Red."]);
  assertEquals(errorsOf({ type: "tribeChange", kind: "start", moves: { 7: 10 } }), ["Gus is already out of the game."]);
  assertEquals(cardRows({ type: "tribeChange", kind: "start", moves: { 1: 99 } }, big, { tribeOf: {}, out: [], held: {} }).errors,
    ["Pick a tribe in this season for Ann, or no tribe."]);
});

Deno.test("a custom Starting tribe row can have no tribe; other tribe changes can't", () => {
  assertEquals(cardRows(custom({ eventTypeId: E.startingTribe, castawayId: 1 }), big, g).errors, []);
  assertEquals(cardRows(custom({ eventTypeId: E.swappedTribes, castawayId: 1 }), big, g).errors, ['"Swapped tribes" needs a tribe.']);
});

Deno.test("challenge: tribe immunity with 2nd place and a sit-out", () => {
  assertEquals(rowsOf({ type: "challenge", prize: "immunity", format: "tribe", first: 10, second: 12, satOut: [2] }), [
    ["Ann", "Won team immunity", 10],
    ["Eve", "Won team immunity (2nd place)", 12], ["Fay", "Won team immunity (2nd place)", 12],
    ["Bea", "Sat out of challenge", 10],
  ]);
  assertEquals(errorsOf({ type: "challenge", prize: "immunity", format: "tribe", first: 10, second: 10 }),
    ["1st and 2nd place can't be the same tribe."]);
});

Deno.test("challenge: immunity + reward makes immunity rows only", () => {
  assertEquals(rowsOf({ type: "challenge", prize: "both", format: "tribe", first: 11 }),
    [["Cal", "Won team immunity", 11], ["Dee", "Won team immunity", 11]]);
});

Deno.test("challenge: a sit-out carries the tribe only in a tribe challenge", () => {
  assertEquals(rowsOf({ type: "challenge", prize: "immunity", format: "individual", first: 3, satOut: [1] }),
    [["Cal", "Won individual immunity", null], ["Ann", "Sat out of challenge", null]]);
  // Bea, Eve and Fay weren't put on a team, so they sat out too
  assertEquals(rowsOf({ type: "challenge", prize: "immunity", format: "teams", teamCount: 2, teams: { 3: 1, 4: 2 },
    first: 1, satOut: [1] }), [["Cal", "Won team immunity", null], ["Ann", "Sat out of challenge", null],
    ["Bea", "Sat out of challenge", null], ["Eve", "Sat out of challenge", null], ["Fay", "Sat out of challenge", null]]);
});

Deno.test("challenge: individual reward with people brought along", () => {
  assertEquals(rowsOf({ type: "challenge", prize: "reward", format: "individual", first: 3, broughtOnReward: [1, 5] }),
    [["Cal", "Won individual reward", null], ["Ann", "Brought on reward", null], ["Eve", "Brought on reward", null]]);
  assertEquals(errorsOf({ type: "challenge", prize: "reward", format: "individual", first: 3, broughtOnReward: [3] }),
    ["The winner can't bring themselves."]);
});

Deno.test("challenge: a tribe or team reward can bring people along too", () => {
  // Blue (Cal, Dee) won reward and took Ann from Red
  assertEquals(rowsOf({ type: "challenge", prize: "reward", format: "tribe", first: 11, broughtOnReward: [1] }),
    [["Cal", "Won team reward", 11], ["Dee", "Won team reward", 11], ["Ann", "Brought on reward", null]]);
  assertEquals(errorsOf({ type: "challenge", prize: "reward", format: "tribe", first: 11, broughtOnReward: [4] }),
    ["Dee won the reward, so wasn't brought on it."]);
  // Immunity + reward: the winners' rows are immunity, and the guest is brought on the reward
  assertEquals(rowsOf({ type: "challenge", prize: "both", format: "teams", teamCount: 2,
    teams: { 1: 1, 2: 1, 3: 2, 4: 2, 5: 2, 6: 2 }, first: 1, broughtOnReward: [3] }),
    [["Ann", "Won team immunity", null], ["Bea", "Won team immunity", null], ["Cal", "Brought on reward", null]]);
  // Immunity alone has no reward to bring anyone on
  assertEquals(rowsOf({ type: "challenge", prize: "immunity", format: "tribe", first: 11, broughtOnReward: [1] }),
    [["Cal", "Won team immunity", 11], ["Dee", "Won team immunity", 11]]);
});

Deno.test("challenge: a tribe reward with people brought along rebuilds as the same card", () => {
  const card = { type: "challenge", prize: "reward", format: "tribe", first: 11, second: null, teamCount: 2, teams: {},
    satOut: [], broughtOnReward: [1, 5] };
  const before = Object.keys(g.tribeOf).map(Number).map((id, i) => toEventRow({ castawayId: id, eventType: big.eventTypeById.get(E.swappedTribes)!,
    otherCastawayId: null, advantageId: null, newAdvantage: null, tribeId: g.tribeOf[id], quantity: 1, details: null }, big, 1, i + 1));
  const rows = cardRows(card, big, { ...g, out: [] }).rows.map((r, i) => toEventRow(r, big, 2, i + 1));
  const rebuilt = rebuildEpisode(rows, before, big, new Map([["Red", 10], ["Blue", 11], ["Green", 12]]), new Map());
  assertEquals(rebuilt.fallbacks, []);
  assertEquals(rebuilt.cards, [card]);
});

Deno.test("challenge: teams that aren't tribes", () => {
  // Everyone is on a team (Eve and Fay on Team 2), so no one sat out
  assertEquals(rowsOf({ type: "challenge", prize: "immunity", format: "teams", teamCount: 3,
    teams: { 1: 1, 3: 1, 2: 2, 5: 2, 6: 2, 4: 3 }, first: 1, second: 3 }),
    [["Ann", "Won team immunity", null], ["Cal", "Won team immunity", null], ["Dee", "Won team immunity (2nd place)", null]]);
  // Anyone left off every team sat out
  assertEquals(rowsOf({ type: "challenge", prize: "immunity", format: "teams", teamCount: 2,
    teams: { 1: 1, 2: 1, 3: 2, 4: 2 }, first: 2 }),
    [["Cal", "Won team immunity", null], ["Dee", "Won team immunity", null],
     ["Eve", "Sat out of challenge", null], ["Fay", "Sat out of challenge", null]]);
  assertEquals(errorsOf({ type: "challenge", prize: "immunity", format: "teams", teamCount: 2, teams: { 1: 1 }, first: 2 }),
    ["No one is on Team 2."]);
});

Deno.test("tribal: votes, then whoever each was for receiving it, then whoever went home", () => {
  // Red and Blue merged into one group for this test: Ann, Bea, Cal at Tribal on Red
  const red3: GameState = { ...g, tribeOf: { ...g.tribeOf, 3: 10 } };
  assertEquals(rowsOf({ type: "tribal", tribeId: 10, outcome: "voted", bootId: 3, votes: { 1: 3, 2: 1, 3: "none" } }, red3), [
    ["Ann", "Voted correctly", "Cal"], ["Bea", "Voted incorrectly", "Ann"],
    ["Cal", "Received a vote", "Ann"], ["Ann", "Received a vote", "Bea"],
    ["Cal", "Voted out", null],
  ]);
  assertEquals(cardRows({ type: "tribal", tribeId: 10, outcome: "voted", bootId: 3, votes: { 1: 3 } }, big, red3).errors,
    ["Pick who Bea voted for, or No vote.", "Pick who Cal voted for, or No vote."]);
  assertEquals(cardRows({ type: "tribal", tribeId: 10, outcome: "voted", bootId: 3, votes: { 1: 1, 2: 1, 3: 1 } }, big, red3).errors,
    ["Ann's vote has to be for someone else at this Tribal."]);
});

Deno.test("tribal: received votes are in order of the voter's name, ignoring case", () => {
  const red3: GameState = { ...g, tribeOf: { ...g.tribeOf, 3: 10 } };
  // Ann (id 1) renamed "zoe" and Bea (id 2) "Yan": by name the voters go Cal, Yan, zoe
  const renamed: SeasonData = { ...big, castawayById: new Map(big.castawayById) };
  renamed.castawayById.set(1, { ...big.castawayById.get(1)!, name: "zoe" });
  renamed.castawayById.set(2, { ...big.castawayById.get(2)!, name: "Yan" });
  const made = cardRows({ type: "tribal", tribeId: 10, outcome: "voted", bootId: 3, votes: { 1: 3, 2: 3, 3: 1 } }, renamed, red3);
  assertEquals(made.errors, []);
  assertEquals(made.rows.map(r => [r.castawayId, r.eventType.id, r.otherCastawayId]), [
    [1, E.votedCorrectly, 3], [2, E.votedCorrectly, 3], [3, E.votedIncorrectly, 1],
    [1, E.receivedVote, 3], [3, E.receivedVote, 2], [3, E.receivedVote, 1],
    [3, E.votedOut, null],
  ]);
});

Deno.test("tribal: Shot in the Dark takes the place of a vote, with one row for how it went", () => {
  const red3: GameState = { ...g, tribeOf: { ...g.tribeOf, 3: 10 } };
  const tribal = (fields: Record<string, unknown>) => ({ type: "tribal", tribeId: 10, outcome: "voted", bootId: 3, ...fields });
  // Bea rolls and is saved; Ann and Cal vote for each other
  assertEquals(rowsOf(tribal({ votes: { 1: 3, 2: "shot", 3: 1 }, safe: { 2: "shot" } }), red3), [
    ["Ann", "Voted correctly", "Cal"], ["Bea", "Played Shot in the Dark (safe)", null], ["Cal", "Voted incorrectly", "Ann"],
    ["Cal", "Received a vote", "Ann"], ["Ann", "Received a vote", "Cal"], ["Cal", "Voted out", null],
  ]);
  // Cal's vote for Bea, saved by Shot in the Dark, didn't count
  assertEquals(rowsOf(tribal({ bootId: 1, votes: { 1: 3, 2: "shot", 3: 2 }, safe: { 2: "shot" } }), red3)
    .filter(r => String(r[1]).startsWith("Received")), [["Cal", "Received a vote", "Ann"], ["Bea", "Received a nullified vote", "Cal"]]);
  // Bea rolls and isn't saved
  assertEquals(rowsOf(tribal({ votes: { 1: 3, 2: "shot", 3: 1 } }), red3).filter(r => r[0] === "Bea"),
    [["Bea", "Played Shot in the Dark (not safe)", null]]);
  assertEquals(cardRows(tribal({ votes: { 1: 3, 2: 3, 3: 1 }, safe: { 2: "shot" } }), big, red3).errors,
    ["Bea didn't play Shot in the Dark."]);
});

Deno.test("tribal: whoever is safe can't go home, and votes for them still count", () => {
  const red3: GameState = { ...g, tribeOf: { ...g.tribeOf, 3: 10 } };
  const tribal = (fields: Record<string, unknown>) => ({ type: "tribal", tribeId: 10, outcome: "voted", bootId: 3, ...fields });
  // Ann has an idol played on her: Bea's vote for her is incorrect, and Ann's receiving it is nullified
  assertEquals(rowsOf(tribal({ votes: { 1: 3, 2: 1, 3: 2 }, safe: { 1: "idol" } }), red3), [
    ["Ann", "Voted correctly", "Cal"], ["Bea", "Voted incorrectly", "Ann"], ["Cal", "Voted incorrectly", "Bea"],
    ["Cal", "Received a vote", "Ann"], ["Ann", "Received a nullified vote", "Bea"], ["Bea", "Received a vote", "Cal"],
    ["Cal", "Voted out", null],
  ]);
  assertEquals(cardRows(tribal({ votes: { 1: 3, 2: 3, 3: 1 }, safe: { 3: "immunity" } }), big, red3).errors,
    ["Cal was safe with immunity, so didn't go home."]);
  assertEquals(cardRows(tribal({ bootId: 2, votes: { 1: 2, 2: "shot", 3: 2 }, safe: { 2: "shot" } }), big, red3).errors,
    ["Bea was safe with Shot in the Dark, so didn't go home."]);
  assertEquals(cardRows(tribal({ votes: { 1: 3, 2: 3, 3: 1 }, safe: { 4: "idol" } }), big, red3).errors,
    ["Dee wasn't at this Tribal, so can't be safe at it."]);
  assertEquals(cardRows(tribal({ votes: { 1: 3, 2: 3, 3: 1 }, safe: { 1: "luck" } }), big, red3).errors,
    ["Pick why Ann was safe."]);
});

Deno.test("tribal: a Shot in the Dark Tribal rebuilds as the same card", () => {
  const red3: GameState = { ...g, tribeOf: { ...g.tribeOf, 3: 10 } };
  const card = { type: "tribal", tribeId: 10, outcome: "voted", bootId: 3, votes: { 1: 3, 2: "shot", 3: 1 }, safe: { 2: "shot" } };
  const before = [1, 2, 3, 4, 5, 6].map((id, i) => toEventRow({ castawayId: id, eventType: big.eventTypeById.get(E.swappedTribes)!,
    otherCastawayId: null, advantageId: null, newAdvantage: null, tribeId: red3.tribeOf[id], quantity: 1, details: null }, big, 1, i + 1));
  const rows = cardRows(card, big, { ...red3, out: [] }).rows.map((r, i) => toEventRow(r, big, 2, i + 1));
  const rebuilt = rebuildEpisode(rows, before, big, new Map([["Red", 10], ["Blue", 11], ["Green", 12]]), new Map());
  assertEquals(rebuilt.fallbacks, []);
  assertEquals(rebuilt.cards, [card]);
});

Deno.test("tribal: voting in pairs: a vote is for a pair, and the pair goes home together", () => {
  // Everyone on Red and Blue at one Tribal: Ann & Bea, Cal & Dee
  const four: GameState = { ...g, tribeOf: { ...g.tribeOf, 3: 10, 4: 10 } };
  const tribal = (fields: Record<string, unknown>) =>
    ({ type: "tribal", tribeId: 10, outcome: "voted", bootId: 3, pairs: { 1: 1, 2: 1, 3: 2, 4: 2 }, ...fields });
  // Ann and Bea vote for Cal & Dee (naming either one), Cal and Dee for Ann & Bea: Cal & Dee go home. Both partners
  // receive each vote for their pair.
  assertEquals(rowsOf(tribal({ votes: { 1: 3, 2: 4, 3: 1, 4: 2 } }), four), [
    ["Ann", "Voted correctly", null], ["Bea", "Voted correctly", null],
    ["Cal", "Voted incorrectly", null], ["Dee", "Voted incorrectly", null],
    ["Cal", "Received a vote", "Ann"], ["Dee", "Received a vote", "Ann"], ["Cal", "Received a vote", "Bea"],
    ["Dee", "Received a vote", "Bea"], ["Ann", "Received a vote", "Cal"], ["Bea", "Received a vote", "Cal"],
    ["Ann", "Received a vote", "Dee"], ["Bea", "Received a vote", "Dee"],
    ["Cal", "Voted out", null], ["Dee", "Voted out", null],
  ]);
  // Each vote row names the whole pair it was for
  assertEquals(cardRows(tribal({ votes: { 1: 3, 2: 4, 3: 1, 4: 2 } }), big, four).rows
    .filter(r => r.eventType.name.startsWith("Voted c") || r.eventType.name.startsWith("Voted i")).map(r => r.details),
    ["Cal & Dee", "Cal & Dee", "Ann & Bea", "Ann & Bea"]);
  assertEquals(cardRows(tribal({ votes: { 1: 2, 2: 3, 3: 1, 4: 1 } }), big, four).errors,
    ["Ann can't vote for their own pair."]);
  assertEquals(cardRows(tribal({ pairs: { 1: 1, 2: 1, 3: 2 }, votes: { 1: 3, 2: 3, 3: 1, 4: 1 } }), big, four).errors,
    ["Put Dee in a pair."]);
  assertEquals(cardRows(tribal({ votes: { 1: 3, 2: 3, 3: 1, 4: 1 }, safe: { 4: "idol" } }), big, four).errors,
    ["Dee was safe with an idol, so didn't go home."]);
});

Deno.test("tribal: rocks takes no votes", () => {
  assertEquals(rowsOf({ type: "tribal", tribeId: 11, outcome: "rocks", bootId: 4, votes: {} }), [["Dee", "Went home on rocks", null]]);
  assertEquals(errorsOf({ type: "tribal", tribeId: 11, outcome: "rocks", bootId: 1, votes: {} }), ["Ann wasn't at this Tribal."]);
});

Deno.test("exit and moments", () => {
  assertEquals(rowsOf({ type: "exit", reason: "medevac", castawayId: 5 }), [["Eve", "Medically evacuated", null]]);
  assertEquals(errorsOf({ type: "exit", reason: "quit", castawayId: 8 }), ["Hal is already out of the game."]);
  const iconic = cardRows({ type: "moment", kind: "iconic", castawayId: 1, note: " Tree mail rap " }, big, g).rows[0];
  assertEquals([iconic.eventType.name, iconic.details], ["Had an iconic moment", "Tree mail rap"]);
  assertEquals(errorsOf({ type: "moment", kind: "iconic", castawayId: 1, note: "" }), ["Say what happened."]);
  assertEquals(rowsOf({ type: "moment", kind: "cried", castawayId: 2 }), [["Bea", "Cried on camera", null]]);
});

Deno.test("final tribal: a row per juror's vote, then the winner", () => {
  assertEquals(rowsOf({ type: "ftc", votes: { 8: 1, 7: 1 } }),
    [["Ann", "Received a jury vote", "Gus"], ["Ann", "Received a jury vote", "Hal"], ["Ann", "Became Sole Survivor", null]]);
  assertEquals(rowsOf({ type: "ftc", votes: { 8: 2, 7: 2, 3: 1 } }, { ...g, out: [3, 7, 8] }).at(-1), ["Bea", "Became Sole Survivor", null]);
  assertEquals(errorsOf({ type: "ftc", votes: { 8: 1, 7: 2 } }), ["The jury vote is tied."]);
  assertEquals(errorsOf({ type: "ftc", votes: { 2: 1 } }), ["Bea is still in the game, so isn't on the jury."]);
  assertEquals(errorsOf({ type: "ftc", votes: { 8: 7 } }), ["Hal's vote has to be for a finalist."]);
  assertEquals(errorsOf({ type: "ftc", votes: {} }), ["Enter the jury's votes."]);
});

Deno.test("only the episode after the last entered can be entered", () => {
  assertEquals(episodeProblem(6, 5), null);
  assertEquals(episodeProblem(1, 0), null);
  assertEquals(episodeProblem(5, 5), "Episode 5 is already entered.");
  assertEquals(episodeProblem(7, 5), "Enter episode 6 first.");
  assertEquals(episodeProblem(3, 0), "Enter episode 1 first.");
});

Deno.test("any entered episode can be edited, and nothing else", () => {
  assertEquals(episodeProblem(1, 5, true), null);
  assertEquals(episodeProblem(5, 5, true), null);
  assertEquals(episodeProblem(6, 5, true), "Episode 6 isn't entered yet, so there's nothing to edit.");
});
