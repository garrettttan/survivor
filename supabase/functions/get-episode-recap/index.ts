// get-episode-recap: what happened in one episode, for the site's recap. Public (called with the publishable key).
//
// GET ?season=N&episode=E →
//   { season, episode,
//     items:   RecapItem[],                (see recap.ts: one per card, in order)
//     rebuilt: boolean,                    (the episode has no stored cards; they were rebuilt from its rows)
//     tribes:  [{ id, name, color }] }     (items name tribes by id; castaways by the ids get-draft-data uses)
//
// The cards are the ones the episode was entered from (episode_cards), or, for an episode entered before cards were
// kept, rebuilt from its saved rows the way the admin page does.

// From npm rather than jsr.io: fetching from jsr.io kept timing out while Supabase bundled the function
import { withSupabase } from "npm:@supabase/server@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { loadSeason, loadSeasonRows, loadStoredCards, type Season } from "../episode-entry/data.ts";
import { episodeCards, type Lookups } from "../episode-entry/edit.ts";
import { recapItems } from "./recap.ts";

// The admin page leaves out Legacy event types (old seasons' lump "Episode points"), but their rows still show
// up in a recap, as rows no card describes: add them, with this season's points, so the recap can show those points
export async function addLegacyEventTypes(supabase: SupabaseClient, data: Season): Promise<void> {
  const { data: types, error } = await supabase.from("event_types")
    .select("id, category, name, changes_tribe, ends_game, advantage_effect, scoring(points, season, draft_id)")
    .eq("category", "Legacy");
  if (error) throw new Error(error.message);
  for (const t of types ?? []) {
    const scoring = (t.scoring as { points: number; season: number; draft_id: number | null }[])
      .find(s => s.season === data.season && s.draft_id === null);
    data.eventTypeById.set(t.id, {
      id: t.id, category: t.category, name: t.name, changesTribe: t.changes_tribe, endsGame: t.ends_game,
      advantageEffect: t.advantage_effect, points: Number(scoring?.points ?? 0),
    });
  }
}

// Reads a required whole-number query parameter: the number, or an error message if it's missing or invalid
function getIntParam(params: URLSearchParams, name: string): number | string {
  const raw = params.get(name);
  if (raw === null) return `Parameter '${name}' is required.`;
  if (!/^\d+$/.test(raw)) return `Parameter '${name}' must be an integer.`;
  return Number(raw);
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, { supabase }) => {
    const params = new URL(req.url).searchParams;
    const season = getIntParam(params, "season");
    const episode = getIntParam(params, "episode");
    if (typeof season === "string") return Response.json({ error: season }, { status: 400 });
    if (typeof episode === "string") return Response.json({ error: episode }, { status: 400 });

    try {
      const [data, events, stored] = await Promise.all([
        loadSeason(supabase, season), loadSeasonRows(supabase, season), loadStoredCards(supabase, season),
      ]);
      if (!events.some(e => e.episode === episode)) {
        return Response.json({ error: `Season ${season} has no episode ${episode}.` }, { status: 404 });
      }
      const lookups: Lookups = {
        tribeIdByName: new Map(data.tribes.map(t => [t.name, t.id])),
        advantageIdByName: new Map(data.advantages.map(a => [a.name, a.id])),
      };
      const { cards, rebuilt } = episodeCards(episode, events, stored, data, lookups);
      await addLegacyEventTypes(supabase, data);
      return Response.json({ season, episode, items: recapItems(cards, data), rebuilt, tribes: data.tribes });
    } catch (err) {
      console.error(err);
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }),
};
