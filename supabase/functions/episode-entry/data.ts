// Loads what episode-entry needs for one season: its castaways, tribes, event types with points, advantages, and
// the saved events before the episode being entered. Reads go through the caller's client, so RLS applies.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { EventRow } from "../_shared/replay.ts";
import type { Advantage, Castaway, EventType, SeasonData, Tribe } from "./cards.ts";

export interface Season extends SeasonData {
  castaways: Castaway[];
  tribes: Tribe[];
  eventTypes: EventType[];
  advantages: Advantage[];
  maxEpisode: number;                            // the highest episode with events, 0 for none
}

// Throws the query's error, so the handler can report it
function rowsOf<T>(result: { data: T[] | null; error: { message: string } | null }): T[] {
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

export async function loadSeason(supabase: SupabaseClient, season: number): Promise<Season> {
  const [castaways, tribes, eventTypes, scoring, advantages, last] = await Promise.all([
    supabase.from("castaways").select("id, first_name, last_name, name, nickname").eq("season", season).order("id"),
    supabase.from("tribes").select("id, name, color").eq("season", season).order("id"),
    supabase.from("event_types").select("id, category, name, changes_tribe, ends_game, advantage_effect")
      .neq("category", "Legacy").order("id"),
    supabase.from("scoring").select("event_type_id, points").eq("season", season).is("draft_id", null),
    supabase.from("advantages").select("id, name").eq("season", season).order("id"),
    supabase.from("events").select("episode").eq("season", season).order("episode", { ascending: false }).limit(1),
  ]);

  const pointsByType = new Map(rowsOf(scoring).map(s => [s.event_type_id as number, Number(s.points)]));
  const data: Season = {
    season,
    castaways: rowsOf(castaways).map(c => ({
      id: c.id, firstName: c.first_name, lastName: c.last_name, name: c.name ?? `${c.first_name} ${c.last_name}`,
      nickname: c.nickname,
    })),
    tribes: rowsOf(tribes) as Tribe[],
    eventTypes: rowsOf(eventTypes).map(t => ({
      id: t.id, category: t.category, name: t.name, changesTribe: t.changes_tribe, endsGame: t.ends_game,
      advantageEffect: t.advantage_effect, points: pointsByType.get(t.id) ?? 0,
    })),
    advantages: rowsOf(advantages) as Advantage[],
    maxEpisode: rowsOf(last)[0]?.episode ?? 0,
    castawayById: new Map(),
    tribeById: new Map(),
    eventTypeByName: new Map(),
    advantageById: new Map(),
  };
  data.castawayById = new Map(data.castaways.map(c => [c.id, c]));
  data.tribeById = new Map(data.tribes.map(t => [t.id, t]));
  data.eventTypeByName = new Map(data.eventTypes.map(t => [t.name, t]));
  data.advantageById = new Map(data.advantages.map(a => [a.id, a]));
  return data;
}

/** The season's saved events before `episode`, oldest first, ready to replay */
export async function loadRowsBefore(supabase: SupabaseClient, season: number, episode: number): Promise<EventRow[]> {
  return rowsOf(await supabase.from("season_events_readable").select("*")
    .eq("season", season).lt("episode", episode)
    .order("episode").order("seq")
    .range(0, 9999)) as EventRow[];              // Supabase returns at most 1,000 rows unless told otherwise
}
