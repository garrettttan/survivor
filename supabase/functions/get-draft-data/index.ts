// get-draft-data: everything the public site shows for one draft. Public (called with the publishable key).
//
// GET ?season=N&draft_id=D →
//   { teams:     { [name]: TeamInfo },
//     castaways: { [id]: CastawayState & { nickname } },   (see _shared/replay.ts)
//     scoring:   { [category]: [{ name, description, points }] },
//     episodeCount, merged, finished }
//
// The castaways come from replaying the draft's events; each team's score is the sum of its castaways' points,
// plus any ghosts (see addGhosts).

// From npm rather than jsr.io: fetching from jsr.io kept timing out while Supabase bundled the function
import { withSupabase } from "npm:@supabase/server@1";
import { jsonReplacer, replay, type CastawayState, type EventRow, type RosterRow } from "../_shared/replay.ts";
import { EVENT_TYPE } from "../_shared/event-types.ts";
import { parseScoring, type ScoringRow } from "./scoring.ts";

// =====================================================================
// Types
// =====================================================================

/** One team's standing, as the site gets it. */
export interface TeamInfo {
  winnerPickId: number;                          // the castaway they picked to win
  memberIds: number[];
  scoreByEpisode: number[];                      // points scored in each episode, ghosts included
  cumulativePoints: number[];                    // running total after each episode
  rankByEpisode: number[];                       // place after each episode; tied teams share a place and the next
                                                 // skips (1, 1, 3)
  points: number;                                // total so far
  activeCount: number;                           // members still in the game
}

/** One row of the teams table, as selected below. */
interface TeamRow {
  name: string;
  winner_pick_id: number;
  ghost_count: number | null;
}

// =====================================================================
// Scoring teams
// =====================================================================

/** Each team (in name order) with its members, how many are still in, and its castaways' points per episode. */
function teamScores(
  teams: TeamRow[], rosters: RosterRow[], castaways: Map<number, CastawayState>, episodeCount: number,
): Map<string, TeamInfo> {
  const infoByName = new Map<string, TeamInfo>();
  for (const t of teams) {
    infoByName.set(t.name, {
      winnerPickId: t.winner_pick_id,
      memberIds: [],
      scoreByEpisode: new Array<number>(episodeCount).fill(0),
      cumulativePoints: [],
      rankByEpisode: [],
      points: 0,
      activeCount: 0,
    });
  }

  for (const r of rosters) {
    const info = infoByName.get(r.team);
    if (!info) continue;
    info.memberIds.push(r.castaway_id);

    const castaway = castaways.get(r.castaway_id);
    if (!castaway) continue;                     // drafted but no events yet: contributes 0
    if (castaway.active) info.activeCount++;
    castaway.pointsByEpisode.forEach((pts, i) => { info.scoreByEpisode[i] += pts; });
  }
  return infoByName;
}

/**
 * Ghosts: a team with fewer castaways than the others can be given ghost members. Each ghost scores the team's
 * per-member average for every episode, so a smaller team isn't behind just for being smaller.
 */
function addGhosts(teams: TeamRow[], infoByName: Map<string, TeamInfo>) {
  for (const t of teams) {
    const info = infoByName.get(t.name);
    const ghostCount = t.ghost_count ?? 0;
    const teamSize = info?.memberIds.length ?? 0;
    if (!info || ghostCount === 0 || teamSize === 0) continue;
    info.scoreByEpisode = info.scoreByEpisode.map(score => score + (score / teamSize) * ghostCount);
  }
}

/** Each team's running total and total, then its place after every episode. */
function addTotalsAndRanks(infoByName: Map<string, TeamInfo>) {
  const all = [...infoByName.values()];
  for (const info of all) {
    let total = 0;
    info.cumulativePoints = info.scoreByEpisode.map(score => (total += score));
    info.points = total;
  }
  for (const info of all) {
    info.rankByEpisode = info.cumulativePoints.map((points, i) =>
      1 + all.filter(other => other.cumulativePoints[i] > points).length);
  }
}

// =====================================================================
// Request handling
// =====================================================================

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
        .order("episode").order("seq")           // oldest first: the replay must go in order
        .range(0, 9999),                         // Supabase returns at most 1,000 rows unless told otherwise
      supabase
        .from("rosters_readable")
        .select("*")
        .eq("draft_id", draftId),
      supabase                                   // the season's points (draft_id null: not one draft's own)
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
    if (error) return Response.json({ error: error.message }, { status: 500 });

    const teamRows = (teams.data ?? []) as TeamRow[];
    const eventRows = (events.data ?? []) as EventRow[];
    const rosterRows = (rosters.data ?? []) as RosterRow[];
    const episodeCount = eventRows.length > 0 ? eventRows[eventRows.length - 1].episode : 0;

    const castaways = replay(eventRows);
    const infoByName = teamScores(teamRows, rosterRows, castaways, episodeCount);
    addGhosts(teamRows, infoByName);
    addTotalsAndRanks(infoByName);

    // The season is merged once it has a merge row, and finished once it has a winner
    const allCastaways = [...castaways.values()];
    const merged = eventRows.some(e => e.event_type_id === EVENT_TYPE.merged);
    const finished = allCastaways.some(c => c.finish === "winner");

    // Each castaway's nickname (null for none), which the site shows in place of their first name
    const nicknameById = new Map<number, string>((nicknames.data ?? []).map(n => [n.id, n.nickname]));
    const castawaysWithNicknames = new Map(
      [...castaways].map(([id, c]) => [id, { ...c, nickname: nicknameById.get(id) ?? null }]),
    );

    const body = {
      teams: infoByName,
      castaways: castawaysWithNicknames,
      // The embedded event_types is one object per row (scoring has one event type), though it's typed as a list
      scoring: parseScoring((scoring.data ?? []) as unknown as ScoringRow[]),
      episodeCount,
      merged,
      finished,
    };
    return new Response(JSON.stringify(body, jsonReplacer), {
      headers: { "Content-Type": "application/json" },
    });
  }),
};
