// Tests for the shared replay (supabase/functions/_shared/replay.ts).
//
//   deno test --allow-read=supabase/functions supabase/functions/tests/
//
// The real seasons must replay exactly as recorded in tests/fixtures/draft-N.expected.json (see record-expected.ts),
// and switches (Switched tribes) must stay separate moves from a swap.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { replay, type CastawayState, type EventRow } from "../_shared/replay.ts";
import { EVENT_TYPE as E } from "../_shared/event-types.ts";
import { TYPE_NAME } from "./event-types.ts";
import { replayJson } from "./replay-json.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);

for (const entry of Deno.readDirSync(FIXTURES)) {
  const match = entry.name.match(/^draft-(\d+)\.json$/);
  if (!match) continue;
  Deno.test(`draft ${match[1]} replays exactly as recorded`, async () => {
    const { season, events } = JSON.parse(await Deno.readTextFile(new URL(entry.name, FIXTURES)));
    const expected = JSON.parse(await Deno.readTextFile(new URL(`draft-${match[1]}.expected.json`, FIXTURES)));
    assertEquals(replayJson(replay(events)), expected, `season ${season} changed`);
  });
}

// ── Switches ─────────────────────────────────────────────────────────────────
// Rows shaped like season_events_readable (no draft_id). Castaways 1-2 start on Red, 3-4 on Blue.
const NAMES: Record<number, string> = { 1: "Ann", 2: "Bea", 3: "Cal", 4: "Dee" };
const COLORS: Record<string, string> = { Red: "#b91c1c", Blue: "#0284c7" };
let seq = 0;

function tribeRow(episode: number, castawayId: number, eventTypeId: number, tribe: string): EventRow {
  seq++;
  return {
    event_id: seq, season: 99, episode, seq, castaway_id: castawayId,
    castaway_first_name: NAMES[castawayId], castaway_last_name: "Test",
    category: "Tribes", event: TYPE_NAME[eventTypeId], event_type_id: eventTypeId, changes_tribe: true, ends_game: false, advantage_effect: null,
    advantage_id: null, advantage: null, tribe_id: null, tribe, tribe_color: COLORS[tribe],
    other_castaway_id: null, other_castaway: null, details: null, quantity: 1, points: 0,
  };
}

const startingTribes = (): EventRow[] => [
  tribeRow(1, 1, E.startingTribe, "Red"), tribeRow(1, 2, E.startingTribe, "Red"),
  tribeRow(1, 3, E.startingTribe, "Blue"), tribeRow(1, 4, E.startingTribe, "Blue"),
];

// The castaway's stint on `tribe` that started in `episode`
function stint(castaways: Map<number, CastawayState>, id: number, tribe: string, episode: number) {
  const found = castaways.get(id)!.tribes.find(t => t.tribeName === tribe && t.startEpisode === episode);
  assert(found, `${NAMES[id]} has no ${tribe} stint from episode ${episode}`);
  return found;
}

Deno.test("a switch right after a swap is its own move, not part of the swap", () => {
  // Episode 2: Ann and Cal swap tribes, then Bea switches to Blue on her own
  const castaways = replay([
    ...startingTribes(),
    tribeRow(2, 1, E.swappedTribes, "Blue"), tribeRow(2, 3, E.swappedTribes, "Red"),
    tribeRow(2, 2, E.switchedTribes, "Blue"),
  ]);
  // The swap happens first, so Cal arrives on Red while Bea is still there (grouped together, Bea would have
  // left before Cal arrived)
  assert(stint(castaways, 3, "Red", 2).memberIds.has(2), "Cal should overlap with Bea on Red");
  // Bea's switch lands her on Blue with Ann and Dee, and is recorded as a switch
  const bea = stint(castaways, 2, "Blue", 2);
  assertEquals([...bea.memberIds].sort(), [1, 4]);
  assertEquals(bea.startReason, "Switched tribes");
});

Deno.test("two switches in a row are two separate moves", () => {
  // Episode 2: Ann switches to Blue, then Cal switches to Red
  const castaways = replay([
    ...startingTribes(),
    tribeRow(2, 1, E.switchedTribes, "Blue"), tribeRow(2, 3, E.switchedTribes, "Red"),
  ]);
  // Ann reaches Blue while Cal is still there (grouped as one swap, they'd never have overlapped)
  assert(stint(castaways, 1, "Blue", 2).memberIds.has(3), "Ann should overlap with Cal on Blue");
  assertEquals([...stint(castaways, 3, "Red", 2).memberIds].sort(), [2]);
});

Deno.test("a swap's rows still move together", () => {
  // Episode 2: Ann and Cal swap; neither should count the other as a tribemate on the new tribes
  const castaways = replay([
    ...startingTribes(),
    tribeRow(2, 1, E.swappedTribes, "Blue"), tribeRow(2, 3, E.swappedTribes, "Red"),
  ]);
  assertEquals([...stint(castaways, 1, "Blue", 2).memberIds].sort(), [4]);
  assertEquals([...stint(castaways, 3, "Red", 2).memberIds].sort(), [2]);
});

// ── Finish ───────────────────────────────────────────────────────────────────
// An event row that isn't a tribe change: a vote-out ends Cal's game, and the winner's row ends the season
function eventRow(episode: number, castawayId: number, eventTypeId: number, endsGame = false): EventRow {
  return { ...tribeRow(episode, castawayId, eventTypeId, "Red"), category: "Voting", changes_tribe: false, ends_game: endsGame, tribe: null };
}

Deno.test("the winner and everyone still in at the end get a finish", () => {
  const castaways = replay([
    ...startingTribes(),
    eventRow(2, 3, E.votedOut, true), eventRow(2, 4, E.votedOut, true),
    eventRow(3, 1, E.soleSurvivor),
  ]);
  assertEquals([1, 2, 3, 4].map(id => castaways.get(id)!.finish), ["winner", "finalist", null, null]);
});

Deno.test("nobody has a finish until someone wins", () => {
  const castaways = replay([...startingTribes(), eventRow(2, 3, E.votedOut, true)]);
  assertEquals([1, 2, 3, 4].map(id => castaways.get(id)!.finish), [null, null, null, null]);
});
