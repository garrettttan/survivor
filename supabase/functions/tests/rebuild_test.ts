// Tests for rebuilding cards from saved rows (episode-entry/rebuild.ts), against every real season.
//
//   deno test --allow-read=supabase/functions supabase/functions/tests/

import { assertEquals } from "jsr:@std/assert@1";
import type { EventRow } from "../_shared/replay.ts";
import { cardRows, toEventRow } from "../episode-entry/cards.ts";
import { gameState } from "../episode-entry/game.ts";
import { rebuildSeason } from "../episode-entry/rebuild.ts";
import { fixtureSeasons } from "./fixture-season.ts";

const seasons = fixtureSeasons();

// The rows as a sorted list of what makes each one that row
const rowKeys = (rows: EventRow[]) => rows.map(r => JSON.stringify([r.castaway_id, r.event, r.other_castaway_id,
  r.advantage_id, r.tribe_id, Number(r.quantity ?? 1), r.details ?? null])).sort();

// Whatever the rows, the rebuilt cards remake them: checked here card by card, apart from the rebuild's own check,
// with each card played against the game the cards before it make
for (const s of seasons) {
  Deno.test(`draft ${s.draftId} (season ${s.data.season}): the rebuilt cards remake every episode`, () => {
    const rebuilt = rebuildSeason(s.events, s.data, s.tribeIdByName, s.advantageIdByName);
    for (const [episode, { cards }] of rebuilt) {
      const replayed = s.events.filter(e => e.episode < episode);
      const made: EventRow[] = [];
      cards.forEach((card, i) => {
        const { rows, errors } = cardRows(card, s.data, gameState(replayed, s.tribeIdByName, s.advantageIdByName));
        assertEquals(errors, [], `episode ${episode}, card ${i + 1} (${card.type})`);
        const eventRows = rows.map((r, j) => toEventRow(r, s.data, episode, made.length + j + 1));
        made.push(...eventRows);
        replayed.push(...eventRows);
      });
      assertEquals(rowKeys(made), rowKeys(s.events.filter(e => e.episode === episode)), `episode ${episode}`);
    }
  });
}

// Season 51 rebuilds as real cards only, none of them custom
Deno.test("season 51 rebuilds as real cards only", () => {
  const s = seasons.find(x => x.data.season === 51)!;
  const rebuilt = rebuildSeason(s.events, s.data, s.tribeIdByName, s.advantageIdByName);
  const fallbacks = [...rebuilt].flatMap(([episode, r]) => r.fallbacks.map(f =>
    [episode, s.data.castawayById.get(f.castawayId)!.firstName, f.event]));
  assertEquals(fallbacks, []);
  // Episode 2: Lewis Kelly, who started without a tribe, joins Toka as a move
  const lewis = rebuilt.get(2)!.cards.find(c => c.kind === "move")!;
  assertEquals(s.data.castawayById.get(lewis.castawayId)!.firstName, "Lewis");

  const kinds = (episode: number) => rebuilt.get(episode)!.cards.map(c => c.kind ?? c.action ?? c.type);
  // Episode 1: the starting tribes as one card (Lewis on no tribe), then what happened
  assertEquals(kinds(1), ["start", "cried", "found", "challenge", "tribal"]);
  assertEquals(Object.keys(rebuilt.get(1)!.cards[0].moves).length, 21);
  // Episode 5: two Tribals, the second a consensus after a deadlock, the deadlocked pair on No vote
  const tribals = rebuilt.get(5)!.cards.filter(c => c.type === "tribal");
  assertEquals(tribals.length, 2);
  assertEquals(Object.values(tribals[1].votes).filter(v => v === "none").length, 2);
});
