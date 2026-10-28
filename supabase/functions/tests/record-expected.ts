// Records what the replay produces for each saved fixture (tests/fixtures/draft-N.expected.json), so replay_test.ts
// can check a change to the replay leaves every real season's result alone. Rerun it only when a change to the
// result is intended, and read the diff.
//
//   deno run --allow-read=supabase/functions --allow-write=supabase/functions/tests/fixtures supabase/functions/tests/record-expected.ts

import { replay, type EventRow, type RosterRow } from "../_shared/replay.ts";
import { replayJson } from "./replay-json.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);

for await (const entry of Deno.readDir(FIXTURES)) {
  const match = entry.name.match(/^draft-(\d+)\.json$/);
  if (!match) continue;
  const { events, rosters } = JSON.parse(await Deno.readTextFile(new URL(entry.name, FIXTURES)));
  const result = replayJson(replay(events as EventRow[], rosters as RosterRow[]));
  await Deno.writeTextFile(new URL(`draft-${match[1]}.expected.json`, FIXTURES), JSON.stringify(result, null, 1) + "\n");
  console.log(`draft ${match[1]}: recorded ${Object.keys(result).length} castaways`);
}
