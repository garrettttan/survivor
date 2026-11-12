// An episode's cards → what the site's recap shows, one item per card, in the order they happened. The cards are the
// ones the episode was entered from, or rebuilt from its rows (see episode-entry/edit.ts episodeCards); their shapes
// are listed in js/admin/admin-cards.js. Items name castaways and tribes by id, and advantages by name.

import { SOLE_SURVIVOR, type Card, type SeasonData } from "../episode-entry/cards.ts";

/** A challenge's winners or runners-up: a tribe, or castaways (one for an individual win, a team's members for teams) */
export type Side = { tribeId: number } | { castawayIds: number[] };

export type RecapItem =
  // A swap, the merge, starting tribes (each covers everyone in the game), or one castaway switching tribes
  | { type: "tribes"; kind: "swap" | "merge" | "start" | "move"; tribeId: number | null;
      moves: { castawayId: number; tribeId: number | null }[] }
  | { type: "challenge"; prize: "immunity" | "reward" | "both"; format: "tribe" | "individual" | "teams";
      first: Side | null; second: Side | null; satOut: number[]; broughtOnReward: number[] }
  // Votes in the order the card lists them; a castaway who didn't vote isn't in it. Safe: who couldn't go home, and why.
  // pairs: each pair's members when castaways voted in pairs (a vote for any member is for the whole pair, and the
  // boot's whole pair went home), else empty.
  | { type: "tribal"; tribeId: number | null; outcome: "voted" | "rocks" | "consensus"; bootId: number | null;
      pairs: number[][];
      votes: { voterId: number; targetId: number | null; shot: boolean }[];
      safe: { castawayId: number; reason: "immunity" | "idol" | "shot" }[] }
  // played: targetId is who it was played on, null when they played it for themselves
  | { type: "advantage"; action: "found" | "gave" | "played" | "expired"; castawayId: number | null;
      advantage: string | null; recipientId: number | null; targetId: number | null; changedOutcome: boolean }
  | { type: "exit"; reason: "medevac" | "quit" | "fire"; castawayId: number | null }
  | { type: "moment"; kind: "iconic" | "cried"; castawayId: number | null; note: string }
  // The winner is whoever got the most jury votes
  | { type: "ftc"; votes: { jurorId: number; finalistId: number }[]; winnerId: number | null }
  // A row no card describes (a custom card): shown as the event it is, under its event type's category
  | { type: "event"; event: string; category: string; castawayId: number | null; otherCastawayId: number | null;
      advantage: string | null; tribeId: number | null; details: string | null; points: number };

// ── Helpers ──────────────────────────────────────────────────────────────────

// A card's id field: a number (form inputs can send numeric strings), or null
function id(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

// A card's map of castaway id → value (JSON object keys are strings)
function entries(map: unknown): [number, unknown][] {
  if (!map || typeof map !== "object") return [];
  return Object.entries(map).map(([k, v]) => [Number(k), v]);
}

function ids(list: unknown): number[] {
  return Array.isArray(list) ? list.map(id).filter((n): n is number => n !== null) : [];
}

// An advantage by id, or the name of one first found in that episode's card before it had an id
function advantageName(value: unknown, data: SeasonData): string | null {
  if (typeof value === "string" && value.trim() && id(value) === null) return value.trim();
  const advantageId = id(value);
  return advantageId === null ? null : data.advantageById.get(advantageId)?.name ?? null;
}

// ── Cards → items ────────────────────────────────────────────────────────────

function challengeSide(card: Card, which: unknown): Side | null {
  if (card.format === "teams") {
    const team = id(which);
    if (team === null) return null;
    return { castawayIds: entries(card.teams).filter(([, t]) => id(t) === team).map(([c]) => c) };
  }
  const value = id(which);
  if (value === null) return null;
  return card.format === "individual" ? { castawayIds: [value] } : { tribeId: value };
}

// A Tribal's pairs, each as its members' ids, in pair number order
function pairsOf(card: Card): number[][] {
  const byPair = new Map<number, number[]>();
  for (const [castawayId, pair] of entries(card.pairs)) {
    const n = id(pair);
    if (n === null) continue;
    if (!byPair.has(n)) byPair.set(n, []);
    byPair.get(n)!.push(castawayId);
  }
  return [...byPair].sort((a, b) => a[0] - b[0]).map(([, members]) => members);
}

function tribal(card: Card): RecapItem {
  const votes = entries(card.votes)
    .filter(([, target]) => target !== "none" && target !== null && target !== undefined)
    .map(([voterId, target]) => ({ voterId, targetId: target === "shot" ? null : id(target), shot: target === "shot" }));
  const safe = entries(card.safe)
    .filter(([, reason]) => reason === "immunity" || reason === "idol" || reason === "shot")
    .map(([castawayId, reason]) => ({ castawayId, reason: reason as "immunity" | "idol" | "shot" }));
  return {
    type: "tribal", tribeId: id(card.tribeId), outcome: card.outcome ?? "voted", bootId: id(card.bootId), pairs: pairsOf(card),
    votes, safe,
  };
}

function tribeChange(card: Card): RecapItem {
  const kind = card.kind as "swap" | "merge" | "start" | "move";
  if (kind === "move") {
    const castawayId = id(card.castawayId);
    return { type: "tribes", kind, tribeId: id(card.tribeId),
      moves: castawayId === null ? [] : [{ castawayId, tribeId: id(card.tribeId) }] };
  }
  return { type: "tribes", kind, tribeId: kind === "merge" ? id(card.tribeId) : null,
    moves: entries(card.moves).map(([castawayId, tribeId]) => ({ castawayId, tribeId: id(tribeId) })) };
}

function ftc(card: Card): RecapItem {
  const votes = entries(card.votes)
    .map(([jurorId, finalist]) => ({ jurorId, finalistId: id(finalist) }))
    .filter((v): v is { jurorId: number; finalistId: number } => v.finalistId !== null);
  const counts = new Map<number, number>();
  votes.forEach(v => counts.set(v.finalistId, (counts.get(v.finalistId) ?? 0) + 1));
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const winnerId = ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
  return { type: "ftc", votes, winnerId };
}

// A row no card describes. A winner whose jury votes weren't recorded (so no final Tribal card was rebuilt) is still
// the winner.
function custom(card: Card, data: SeasonData): RecapItem {
  if (card.eventType === SOLE_SURVIVOR) return { type: "ftc", votes: [], winnerId: id(card.castawayId) };
  const eventType = data.eventTypeByName.get(card.eventType);
  const quantity = Number(card.quantity ?? 1) || 1;
  return {
    type: "event", event: String(card.eventType ?? ""), category: eventType?.category ?? "Other",
    castawayId: id(card.castawayId), otherCastawayId: id(card.otherCastawayId),
    advantage: advantageName(card.advantage, data), tribeId: id(card.tribeId),
    details: card.details ? String(card.details) : null, points: (eventType?.points ?? 0) * quantity,
  };
}

/** One recap item for each card, in order. A card of a type the recap doesn't know is left out. */
export function recapItems(cards: Card[], data: SeasonData): RecapItem[] {
  return cards.flatMap((card): RecapItem[] => {
    switch (card?.type) {
      case "tribeChange": return [tribeChange(card)];
      case "challenge": return [{
        type: "challenge", prize: card.prize ?? "immunity", format: card.format ?? "tribe",
        first: challengeSide(card, card.first), second: challengeSide(card, card.second),
        satOut: ids(card.satOut), broughtOnReward: ids(card.broughtOnReward),
      }];
      case "tribal": return [tribal(card)];
      case "advantage": return [{
        type: "advantage", action: card.action, castawayId: id(card.castawayId),
        advantage: advantageName(card.advantage, data), recipientId: id(card.recipientId),
        targetId: id(card.targetId), changedOutcome: card.changedOutcome === true,
      }];
      case "exit": return [{ type: "exit", reason: card.reason, castawayId: id(card.castawayId) }];
      case "moment": return [{ type: "moment", kind: card.kind, castawayId: id(card.castawayId), note: String(card.note ?? "") }];
      case "ftc": return [ftc(card)];
      case "custom": return [custom(card, data)];
      default: return [];
    }
  });
}
