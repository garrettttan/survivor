// From npm rather than jsr.io: fetching from jsr.io kept timing out while Supabase bundled the function
import { withSupabase } from "npm:@supabase/server@1";
import { replay, type EventRow, type RosterRow} from "../_shared/replay.ts";
import { parseScoring, type ScoringRow } from "./scoring.ts";

// =====================================================================
// Types    
// =====================================================================
export interface TeamInfo {
  winnerPickId: number; 
  memberIds: number[]; 
  scoreByEpisode: number[];      // points scored in each episode, ghosts included
  cumulativePoints: number[];    // running total after each episode
  rankByEpisode: number[];       // place after each episode; tied teams share a place and the next skips (1, 1, 3)
  points: number;                // total so far
  activeCount: number;           // members still in the game
}

// =====================================================================
// Utility functions  
// =====================================================================

// Reads a required whole-number query parameter.
// Returns the number, or an error message if it's missing or invalid.
function getIntParam(params: URLSearchParams, name: string): number | string {
  const raw = params.get(name);
  if (raw === null) return `Parameter '${name}' is required.`;
  if (!/^\d+$/.test(raw)) return `Parameter '${name}' must be an integer.`;
  return Number(raw);
}

// =====================================================================
// Main 
// =====================================================================

export default {
  fetch: withSupabase({ auth: "none" }, async (req, { supabase }) => {
    const params = new URL(req.url).searchParams;
    const season = getIntParam(params, "season");
    const draftId = getIntParam(params, "draft_id");

    if (typeof season === "string") return Response.json({ error: season }, { status: 400 });
    if (typeof draftId === "string") return Response.json({ error: draftId }, { status: 400 });

    const [teams, events, rosters, scoring, nicknames] = await Promise.all([
      supabase
        .from("teams")
        .select("name, winner_pick_id, ghost_count")
        .eq("draft_id", draftId)
        .order("name"),
      supabase
        .from("events_readable")
        .select("*")   
        .eq("draft_id", draftId)          
        .order("episode").order("seq")    // oldest first: the replay must go in order
        .range(0, 9999),                  // Supabase returns at most 1,000 rows unless told otherwise
      supabase
        .from("rosters_readable")
        .select("*")
        .eq("draft_id", draftId),
      supabase
        .from("scoring")
        .select("event_types(category, name, description), points")
        .is("draft_id", null)
        .eq("season", season)
        .order("event_types(category)")
        .order("event_types(name)"),
      supabase
        .from("castaways")
        .select("id, nickname")
        .eq("season", season)
        .not("nickname", "is", null),
    ]);

    const error = teams.error ?? events.error ?? rosters.error ?? scoring.error ?? nicknames.error;
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    const castaways = replay(events.data as EventRow[], rosters.data as RosterRow[]);
    const scoringParsed = parseScoring(scoring.data as ScoringRow[])

    const episodeCount = events.data.length > 0 ? events.data[events.data.length - 1].episode : 0;

    const teamToInfo = new Map<string, TeamInfo>(); 
    for (const t of teams.data) {
        const data = {
          winnerPickId: t.winner_pick_id,
          memberIds: [],
          scoreByEpisode: new Array<number>(episodeCount).fill(0),
          cumulativePoints: [],
          rankByEpisode: [],
          points: 0,
          activeCount: 0,
        }; 
        teamToInfo.set(t.name, data);
    }

    for (const r of rosters.data as RosterRow[]) {
      const teamInfo = teamToInfo.get(r.team);
      if (!teamInfo) continue;
      teamInfo.memberIds.push(r.castaway_id);

      const castaway = castaways.get(r.castaway_id);
      if (!castaway) continue;               // drafted but no events yet: contributes 0
      if (castaway.active) teamInfo.activeCount++;
      castaway.pointsByEpisode.forEach((pts, i) => {
        teamInfo.scoreByEpisode[i] += pts;
      });
    }

    for (const t of teams.data) {
      const teamInfo = teamToInfo.get(t.name);
      if (!teamInfo) continue;

      const ghostCount = t.ghost_count ?? 0;      // treat a missing value as no ghosts
      const teamSize = teamInfo.memberIds.length;
      if (ghostCount === 0 || teamSize === 0) continue;

      // Store the new array, and ADD the ghosts' points to the real points
      teamInfo.scoreByEpisode = teamInfo.scoreByEpisode.map(
        (score) => score + (score / teamSize) * ghostCount,
      );
    }

    // Running totals, then each team's place after every episode
    for (const teamInfo of teamToInfo.values()) {
      let total = 0;
      teamInfo.cumulativePoints = teamInfo.scoreByEpisode.map((score) => (total += score));
      teamInfo.points = total;
    }
    const allTeams = [...teamToInfo.values()];
    for (const teamInfo of allTeams) {
      teamInfo.rankByEpisode = teamInfo.cumulativePoints.map((points, i) =>
        1 + allTeams.filter((other) => other.cumulativePoints[i] > points).length);
    }

    // The season is merged once anyone has joined a tribe at the merge, and finished once it has a winner
    const allCastaways = [...castaways.values()];
    const merged = allCastaways.some((c) => c.tribes.some((t) => t.startReason === "Merged"));
    const finished = allCastaways.some((c) => c.finish === "winner");
  
    const toJson = (_key: string, value: unknown) =>
      value instanceof Set ? [...value] :
      value instanceof Map ? Object.fromEntries(value) :
      value;

    // Each castaway's nickname (null for none), which the page shows in place of their first name
    const nicknameById = new Map<number, string>((nicknames.data ?? []).map((n) => [n.id, n.nickname]));
    const castawaysWithNicknames = new Map(
      [...castaways].map(([id, c]) => [id, { ...c, nickname: nicknameById.get(id) ?? null }]),
    );

    const body = {
        teams: teamToInfo,
        castaways: castawaysWithNicknames, 
        scoring: scoringParsed, 
        episodeCount,
        merged,
        finished,
      };

    return new Response(JSON.stringify(body, toJson), {
      headers: { "Content-Type": "application/json" },
    });
  }),
};
