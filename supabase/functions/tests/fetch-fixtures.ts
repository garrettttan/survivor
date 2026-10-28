// Saves every draft's events and rosters from the live project as test fixtures (tests/fixtures/draft-N.json),
// read through the public API with the site's publishable key, so it can only read.
//
//   deno run --allow-net --allow-write=supabase/functions/tests/fixtures supabase/functions/tests/fetch-fixtures.ts

const SUPABASE_URL = "https://zhwtgahrpnlywjaqmhjt.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_d_we7LacUwrG62LXVT9KZw_eWJl-iLI";
const OUT_DIR = new URL("./fixtures/", import.meta.url);

async function get(path: string): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: PUBLISHABLE_KEY } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return await res.json();
}

await Deno.mkdir(OUT_DIR, { recursive: true });
const drafts = await get("drafts?select=id,season&order=id") as { id: number; season: number }[];
for (const { id, season } of drafts) {
  // Same query and order as get-draft-data: oldest first, so the replay goes in order
  const events = await get(`events_readable?draft_id=eq.${id}&order=episode,seq&limit=10000`);
  const rosters = await get(`rosters_readable?draft_id=eq.${id}`);
  await Deno.writeTextFile(new URL(`draft-${id}.json`, OUT_DIR), JSON.stringify({ draftId: id, season, events, rosters }, null, 1) + "\n");
  console.log(`draft ${id} (season ${season}): ${events.length} events, ${rosters.length} roster rows`);
}
