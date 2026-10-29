// episode-entry: the admin page's episode entry backend. The page sends cards (what happened in an episode); this
// turns them into events rows, checks them, and saves them. Every rule lives here, not in the browser.
//
// POST { action, season, episode, cards }:
//   state    the season's castaways, tribes, event types, advantages and the game at the start of the episode
//            (episode null = the one after the last entered)
//   preview  the rows the cards would make, errors per card, warnings, and the game before each card. With
//            edit: true, for an entered episode: also what its rows change, and every later episode replayed after
//            it (its errors and what its rows change)
//   save     a new episode: preview's checks again, then its rows and cards through insert_episode_events
//   replace  an edit: the edit preview's checks again, then the episode and every later one whose rows change,
//            through replace_episodes
// The exact request and response shapes are in js/api/admin-data.js. Only admins (app_metadata.role "admin") may
// call it; reads and the save run as the caller, so RLS applies too.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { episodeProblem, type CardRow } from "./cards.ts";
import { loadSeason, loadSeasonRows, loadStoredCards } from "./data.ts";
import {
  episodeCards, pageRow, playEdit, playEpisode, type Card, type Changes, type LaterEpisode, type Lookups, type PageError,
  type Played,
} from "./edit.ts";
import { gameState } from "./game.ts";

// =====================================================================
// HTTP
// =====================================================================

// The site, and a local copy for testing (python3 -m http.server)
const ALLOWED_ORIGIN = /^(https:\/\/garrettttan\.github\.io|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  return {
    ...(ALLOWED_ORIGIN.test(origin) && { "Access-Control-Allow-Origin": origin, "Vary": "Origin" }),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region, x-supabase-api-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// =====================================================================
// Actions
// =====================================================================

// Everything one request needs about the season
async function load(supabase: SupabaseClient, season: number) {
  const [data, events, stored] = await Promise.all([
    loadSeason(supabase, season), loadSeasonRows(supabase, season), loadStoredCards(supabase, season),
  ]);
  const lookups: Lookups = {
    tribeIdByName: new Map(data.tribes.map(t => [t.name, t.id])),
    advantageIdByName: new Map(data.advantages.map(a => [a.name, a.id])),
  };
  return { data, events, stored, lookups };
}

// For an entered episode, also its cards: stored, or rebuilt from its rows (rebuilt: true, with any rows that
// became custom cards as fallbacks). A new episode has cards: null.
async function state(supabase: SupabaseClient, season: number, requested: number | null) {
  const { data, events, stored, lookups } = await load(supabase, season);
  const episode = requested ?? data.maxEpisode + 1;
  const entered = episode <= data.maxEpisode && events.some(e => e.episode === episode);
  const cards = entered ? episodeCards(episode, events, stored, data, lookups) : null;
  return {
    episode,
    castaways: data.castaways.map(c => ({ id: c.id, name: c.name, firstName: c.firstName, nickname: c.nickname })),
    tribes: data.tribes,
    eventTypes: data.eventTypes.map(t => ({ id: t.id, name: t.name, points: t.points })),
    advantages: data.advantages,
    maxEpisode: data.maxEpisode,
    game: gameState(events.filter(e => e.episode < episode), lookups.tribeIdByName, lookups.advantageIdByName),
    cards: cards?.cards ?? null,
    rebuilt: cards?.rebuilt ?? false,
    fallbacks: cards?.fallbacks ?? [],
  };
}

interface Preview {
  played: Played;
  errors: PageError[];                           // the episode's own, then any about the whole episode
  warnings: string[];
  changes?: Changes;                             // editing: this episode's rows against its saved ones
  later?: LaterEpisode[];                        // editing: every later episode, replayed after the edit
}

// The cards played in order. Editing an entered episode also replays every later episode from its own cards.
async function preview(
  supabase: SupabaseClient, season: number, episode: number, cards: Card[], editing: boolean,
): Promise<Preview> {
  const { data, events, stored, lookups } = await load(supabase, season);
  const problem = episodeProblem(episode, data.maxEpisode, editing);
  if (problem) return { played: { rows: [], errors: [], states: [] }, errors: [{ message: problem }], warnings: [] };

  let result: Preview;
  if (editing) {
    const edit = playEdit(episode, cards, events, stored, data, lookups);
    result = { played: edit.played, errors: [...edit.played.errors], warnings: [], changes: edit.changes, later: edit.later };
  } else {
    const played = playEpisode(cards, episode, data, lookups, events.filter(e => e.episode < episode));
    result = { played, errors: [...played.errors], warnings: [] };
  }
  if (cards.length && !result.played.rows.some(r => r.eventType.endsGame)) result.warnings.push("No one went home this episode.");
  return result;
}

// What the page gets back from a preview
function previewReply(p: Preview) {
  return {
    rows: p.played.rows.map(r => ({ card: r.card, seq: r.seq, ...pageRow(r) })),
    errors: p.errors,
    warnings: p.warnings,
    states: p.played.states,
    ...(p.changes && { changes: p.changes }),
    ...(p.later && {
      later: p.later.map(l => ({ episode: l.episode, errors: l.played.errors, changes: l.changes })),
    }),
  };
}

// One episode as insert_episode_events takes it. Advantages first found this episode are created by the save,
// before the rows that name them by key.
function savedEpisode(rows: CardRow[]) {
  const newAdvantages = [...new Set(rows.map(r => r.newAdvantage).filter((n): n is string => n !== null))];
  return {
    new_advantages: newAdvantages.map(name => ({ key: `new:${name}`, name })),
    rows: rows.map((r, i) => ({
      seq: i + 1, castaway_id: r.castawayId, event_type_id: r.eventType.id, advantage_id: r.advantageId,
      advantage_key: r.newAdvantage === null ? null : `new:${r.newAdvantage}`,
      other_castaway_id: r.otherCastawayId, tribe_id: r.tribeId, quantity: r.quantity, details: r.details,
    })),
  };
}

// A database check (the check_event_fields trigger, a unique key, an entered episode) is a problem to fix, not a
// crash, so it goes back as an error the page shows
function saveResult(data: unknown, error: { message: string } | null) {
  if (error) return { status: 400, body: { errors: [{ message: error.message }] } };
  return { status: 200, body: { inserted: data } };
}

// A new episode: preview's checks again, then its rows and cards in one transaction
async function save(supabase: SupabaseClient, season: number, episode: number, cards: Card[]) {
  const p = await preview(supabase, season, episode, cards, false);
  if (!p.errors.length && !p.played.rows.length) p.errors.push({ message: "Add a card to save." });
  if (p.errors.length) return { status: 400, body: { errors: p.errors } };

  const { new_advantages, rows } = savedEpisode(p.played.rows);
  const { data, error } = await supabase.rpc("insert_episode_events", {
    p_season: season, p_episode: episode, p_new_advantages: new_advantages, p_rows: rows, p_cards: cards,
  });
  return saveResult(data, error);
}

// An edit: the same replay as its preview, then the edited episode and every later one whose rows change, all in
// one transaction. Nothing is saved if any of them has an error; a later episode's error names that episode.
async function replace(supabase: SupabaseClient, season: number, episode: number, cards: Card[]) {
  const p = await preview(supabase, season, episode, cards, true);
  if (!p.errors.length && !p.played.rows.length) p.errors.push({ message: "Add a card to save." });
  const laterErrors = (p.later ?? []).flatMap(l => l.played.errors.map(e =>
    ({ message: `Episode ${l.episode}${e.card === undefined ? "" : `, card ${e.card + 1}`}: ${e.message}` })));
  if (p.errors.length || laterErrors.length) return { status: 400, body: { errors: [...p.errors, ...laterErrors] } };

  const changed = (p.later ?? []).filter(l => l.changes.added.length || l.changes.removed.length);
  const { data, error } = await supabase.rpc("replace_episodes", {
    p_season: season,
    p_episodes: [
      { episode, cards, ...savedEpisode(p.played.rows) },
      ...changed.map(l => ({ episode: l.episode, cards: l.cards, ...savedEpisode(l.played.rows) })),
    ],
  });
  if (error) return saveResult(data, error);
  return { status: 200, body: { replaced: data, episodes: [episode, ...changed.map(l => l.episode)] } };
}

// =====================================================================
// Main
// =====================================================================

function wholeNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new HttpError(400, `"${name}" must be a whole number.`);
  }
  return value;
}

// The caller's client, if they're a signed-in admin. Their session is checked with Supabase Auth.
async function adminClient(req: Request): Promise<SupabaseClient> {
  const authorization = req.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in to enter events.");

  const publishableKey = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}").default
    ?? Deno.env.get("SUPABASE_ANON_KEY");
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Your session has expired. Sign in again.");
  if (data.user.app_metadata?.role !== "admin") throw new HttpError(403, "Only admins can enter events.");
  return supabase;
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: cors });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Use POST.");
    const supabase = await adminClient(req);
    const body = await req.json().catch(() => { throw new HttpError(400, "The request isn't JSON."); });
    const season = wholeNumber(body.season, "season");

    switch (body.action) {
      case "state":
        return json(await state(supabase, season, body.episode == null ? null : wholeNumber(body.episode, "episode")));
      case "preview": {
        const cards = Array.isArray(body.cards) ? body.cards : [];
        const p = await preview(supabase, season, wholeNumber(body.episode, "episode"), cards, body.edit === true);
        return json(previewReply(p));
      }
      case "save":
      case "replace": {
        const cards = Array.isArray(body.cards) ? body.cards : [];
        const write = body.action === "save" ? save : replace;
        const { status, body: result } = await write(supabase, season, wholeNumber(body.episode, "episode"), cards);
        return json(result, status);
      }
      default:
        throw new HttpError(400, `Unknown action "${body.action}".`);
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
