// episode-entry: the admin page's episode entry backend. The page sends cards (what happened in an episode); this
// turns them into events rows, checks them, and saves them. Every rule lives here, not in the browser.
//
// POST { action, season, episode, cards }:
//   state    the season's castaways, tribes, event types, advantages and the game at the start of the episode
//            (episode null = the one after the last entered)
//   preview  the rows the cards would make, errors per card, warnings, and the game before each card
//   save     preview's checks again, then one transaction through insert_episode_events
// The exact request and response shapes are in backend/admin-data.js. Only admins (app_metadata.role "admin") may
// call it; reads and the save run as the caller, so RLS applies too.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { EventRow } from "../_shared/replay.ts";
import { cardRows, toEventRow, type CardRow } from "./cards.ts";
import { loadRowsBefore, loadSeason, type Season } from "./data.ts";
import { gameState, type GameState } from "./game.ts";

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

interface PageError { card?: number; message: string }

interface Preview {
  rows: (CardRow & { card: number; seq: number })[];
  errors: PageError[];
  warnings: string[];
  states: GameState[];
}

function lookups(data: Season) {
  return [
    new Map(data.tribes.map(t => [t.name, t.id])),
    new Map(data.advantages.map(a => [a.name, a.id])),
  ] as const;
}

async function state(supabase: SupabaseClient, season: number, requested: number | null) {
  const data = await loadSeason(supabase, season);
  const episode = requested ?? data.maxEpisode + 1;
  const saved = await loadRowsBefore(supabase, season, episode);
  return {
    episode,
    castaways: data.castaways.map(c => ({ id: c.id, name: c.name, firstName: c.firstName })),
    tribes: data.tribes,
    eventTypes: data.eventTypes.map(t => ({ id: t.id, name: t.name, points: t.points })),
    advantages: data.advantages,
    maxEpisode: data.maxEpisode,
    game: gameState(saved, ...lookups(data)),
  };
}

// Expands the cards in order, replaying after each so the next card's game is known
// deno-lint-ignore no-explicit-any
async function preview(supabase: SupabaseClient, season: number, episode: number, cards: any[]): Promise<Preview> {
  const data = await loadSeason(supabase, season);
  const result: Preview = { rows: [], errors: [], warnings: [], states: [] };
  if (episode <= data.maxEpisode) {
    result.errors.push({ message: `Episode ${episode} is already entered.` });
    return result;
  }
  const replayed: EventRow[] = await loadRowsBefore(supabase, season, episode);
  const [tribeIds, advantageIds] = lookups(data);
  result.states.push(gameState(replayed, tribeIds, advantageIds));

  const cried = new Set<number>();               // crying counts once per castaway per episode
  cards.forEach((card, index) => {
    const { rows, errors } = cardRows(card, data, result.states[result.states.length - 1]);
    for (const row of rows.filter(r => r.eventType.name === "Cried on camera")) {
      if (cried.has(row.castawayId)) errors.push(`${data.castawayById.get(row.castawayId)?.name} already cried this episode.`);
      cried.add(row.castawayId);
    }
    if (errors.length) rows.length = 0;
    for (const message of errors) result.errors.push({ card: index, message });
    for (const row of rows) {
      const seq = result.rows.length + 1;
      result.rows.push({ ...row, card: index, seq });
      replayed.push(toEventRow(row, data, episode, seq));
    }
    result.states.push(gameState(replayed, tribeIds, advantageIds));
  });

  if (cards.length && !result.rows.some(r => r.eventType.endsGame)) result.warnings.push("No one went home this episode.");
  return result;
}

// The page's view of a row: event type by name, and its points
function pageRows(p: Preview) {
  return p.rows.map(r => ({
    card: r.card, seq: r.seq, castawayId: r.castawayId, eventType: r.eventType.name,
    otherCastawayId: r.otherCastawayId, advantage: r.advantageId ?? r.newAdvantage, tribeId: r.tribeId,
    quantity: r.quantity, details: r.details, points: r.eventType.points * r.quantity,
  }));
}

// deno-lint-ignore no-explicit-any
async function save(supabase: SupabaseClient, season: number, episode: number, cards: any[]) {
  const p = await preview(supabase, season, episode, cards);
  if (!p.errors.length && !p.rows.length) p.errors.push({ message: "Add a card to save." });
  if (p.errors.length) return { status: 400, body: { errors: p.errors } };

  // Advantages first found this episode are created by the save, before the rows that name them by key
  const newAdvantages = [...new Set(p.rows.map(r => r.newAdvantage).filter((n): n is string => n !== null))];
  const { data, error } = await supabase.rpc("insert_episode_events", {
    p_season: season,
    p_episode: episode,
    p_new_advantages: newAdvantages.map(name => ({ key: `new:${name}`, name })),
    p_rows: p.rows.map(r => ({
      seq: r.seq, castaway_id: r.castawayId, event_type_id: r.eventType.id, advantage_id: r.advantageId,
      advantage_key: r.newAdvantage === null ? null : `new:${r.newAdvantage}`,
      other_castaway_id: r.otherCastawayId, tribe_id: r.tribeId, quantity: r.quantity, details: r.details,
    })),
  });
  // A database check (the check_event_fields trigger, a unique key, an entered episode) is a problem to fix,
  // not a crash, so it goes back as an error the page shows
  if (error) return { status: 400, body: { errors: [{ message: error.message }] } };
  return { status: 200, body: { inserted: data } };
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
        const p = await preview(supabase, season, wholeNumber(body.episode, "episode"), cards);
        return json({ rows: pageRows(p), errors: p.errors, warnings: p.warnings, states: p.states });
      }
      case "save": {
        const cards = Array.isArray(body.cards) ? body.cards : [];
        const { status, body: result } = await save(supabase, season, wholeNumber(body.episode, "episode"), cards);
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
