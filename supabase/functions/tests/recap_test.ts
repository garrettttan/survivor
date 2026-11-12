// get-episode-recap's cards → recap items (get-episode-recap/recap.ts): every real season's episodes, rebuilt from
// their saved rows as the function does for episodes without stored cards, and hand-made cards for what rows can't
// rebuild (ad-hoc teams, who was safe at Tribal).
//
//   deno test --allow-read=supabase/functions supabase/functions/tests/

import { assert, assertEquals } from "jsr:@std/assert@1";
import { EVENT_TYPE as E } from "../_shared/event-types.ts";
import { rebuildSeason } from "../episode-entry/rebuild.ts";
import { recapItems } from "../get-episode-recap/recap.ts";
import { fixtureSeasons } from "./fixture-season.ts";

const seasons = fixtureSeasons();
const s51 = seasons[0];   // any fixture season works for the hand-made cards: they only look up names and categories

Deno.test("every rebuilt episode becomes one item per card, naming only castaways and tribes in the season", () => {
  for (const s of seasons) {
    const rebuilt = rebuildSeason(s.events, s.data, s.tribeIdByName, s.advantageIdByName);
    for (const [episode, { cards }] of rebuilt) {
      const items = recapItems(cards, s.data);
      assertEquals(items.length, cards.length, `draft ${s.draftId} episode ${episode}`);
      const castawayIds = JSON.stringify(items).match(/"(castawayId|voterId|targetId|bootId|recipientId|jurorId|finalistId|winnerId|otherCastawayId)":\d+/g) ?? [];
      for (const ref of castawayIds) {
        assert(s.data.castawayById.has(Number(ref.split(":")[1])), `draft ${s.draftId} episode ${episode}: ${ref}`);
      }
    }
  }
});

Deno.test("a challenge between ad-hoc teams names each team's members", () => {
  const [item] = recapItems([{
    type: "challenge", prize: "reward", format: "teams", first: 2, second: 1, teamCount: 2,
    teams: { "10": 1, "11": 2, "12": 2, "13": 1 }, satOut: ["14"], broughtOnReward: [],
  }], s51.data);
  assertEquals(item, {
    type: "challenge", prize: "reward", format: "teams",
    first: { castawayIds: [11, 12] }, second: { castawayIds: [10, 13] }, satOut: [14], broughtOnReward: [],
  });
});

Deno.test("a tribe challenge names the tribes; an individual one the winner", () => {
  const [tribe, individual] = recapItems([
    { type: "challenge", prize: "both", format: "tribe", first: 3, second: null, satOut: [], broughtOnReward: [] },
    { type: "challenge", prize: "immunity", format: "individual", first: 7, second: null, satOut: [], broughtOnReward: [8] },
  ], s51.data);
  assertEquals(tribe.type === "challenge" && [tribe.first, tribe.second], [{ tribeId: 3 }, null]);
  assertEquals(individual.type === "challenge" && [individual.first, individual.broughtOnReward], [{ castawayIds: [7] }, [8]]);
});

Deno.test("a Tribal leaves out who didn't vote, marks Shot in the Dark, and lists who was safe", () => {
  const [item] = recapItems([{
    type: "tribal", tribeId: 2, outcome: "voted", bootId: 5,
    votes: { "1": 5, "2": 5, "3": "none", "4": "shot", "5": 1 },
    safe: { "1": "immunity", "6": "idol" },
  }], s51.data);
  assertEquals(item, {
    type: "tribal", tribeId: 2, outcome: "voted", bootId: 5, pairs: [],
    votes: [
      { voterId: 1, targetId: 5, shot: false }, { voterId: 2, targetId: 5, shot: false },
      { voterId: 4, targetId: null, shot: true }, { voterId: 5, targetId: 1, shot: false },
    ],
    safe: [{ castawayId: 1, reason: "immunity" }, { castawayId: 6, reason: "idol" }],
  });
});

Deno.test("a Tribal voted in pairs lists each pair's members", () => {
  const [item] = recapItems([{ type: "tribal", tribeId: 2, outcome: "voted", bootId: 5,
    pairs: { "5": 2, "6": 2, "1": 1, "2": 1 }, votes: { "1": 5 }, safe: {} }], s51.data);
  assertEquals(item.type === "tribal" && [item.bootId, item.pairs], [5, [[1, 2], [5, 6]]]);
});

Deno.test("advantages are named, by id or by the name of one first found that episode", () => {
  const [known] = [...s51.data.advantageById.values()];
  const [gave, found] = recapItems([
    { type: "advantage", action: "gave", castawayId: 1, advantage: known.id, recipientId: 2, targetId: null, changedOutcome: false },
    { type: "advantage", action: "found", castawayId: 3, advantage: "Brand new idol", recipientId: null, targetId: null },
  ], s51.data);
  assertEquals(gave.type === "advantage" && [gave.advantage, gave.recipientId], [known.name, 2]);
  assertEquals(found.type === "advantage" && found.advantage, "Brand new idol");
});

Deno.test("final Tribal: the winner has the most jury votes, and a tie has none", () => {
  const [won, tied] = recapItems([
    { type: "ftc", votes: { "1": 9, "2": 9, "3": 8 } },
    { type: "ftc", votes: { "1": 9, "2": 8 } },
  ], s51.data);
  assertEquals(won.type === "ftc" && won.winnerId, 9);
  assertEquals(tied.type === "ftc" && tied.winnerId, null);
});

Deno.test("a custom card is its event, under its event type's category", () => {
  const [eventType] = [...s51.data.eventTypeById.values()];
  const [item] = recapItems([{
    type: "custom", eventTypeId: eventType.id, castawayId: 4, otherCastawayId: null, advantage: null,
    tribeId: null, quantity: 2, details: "",
  }], s51.data);
  assertEquals(item, {
    type: "event", event: eventType.name, category: eventType.category, castawayId: 4, otherCastawayId: null,
    advantage: null, tribeId: null, details: null, points: eventType.points * 2,
  });
});

Deno.test("a winner whose jury votes weren't recorded is still the winner", () => {
  const [item] = recapItems([{
    type: "custom", eventTypeId: E.soleSurvivor, castawayId: 4, otherCastawayId: null, advantage: null,
    tribeId: null, quantity: 1, details: "",
  }], s51.data);
  assertEquals(item, { type: "ftc", votes: [], winnerId: 4 });
});

Deno.test("tribe changes: a merge names its tribe, a switch its one castaway", () => {
  const [merge, move] = recapItems([
    { type: "tribeChange", kind: "merge", tribeId: 9, moves: {} },
    { type: "tribeChange", kind: "move", castawayId: 4, tribeId: 2, moves: {} },
  ], s51.data);
  assertEquals(merge, { type: "tribes", kind: "merge", tribeId: 9, moves: [] });
  assertEquals(move, { type: "tribes", kind: "move", tribeId: 2, moves: [{ castawayId: 4, tribeId: 2 }] });
});
