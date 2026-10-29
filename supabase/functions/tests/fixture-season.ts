// A fixture's season as the card rules see it, built from saved rows: its castaways, tribes and advantages from its
// own rows, and the name → id lookups gameState takes. Event types aren't per season (episode-entry loads them all),
// so they come from every fixture's rows: a season that never had a sit-out still knows "Sat out of challenge".
// Points aren't in the rows, so every event type scores 0; nothing that compares rows depends on points.

import type { EventRow } from "../_shared/replay.ts";
import type { EventType, SeasonData } from "../episode-entry/cards.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);

export interface FixtureSeason {
  draftId: number;
  events: EventRow[];
  data: SeasonData;
  tribeIdByName: Map<string, number>;
  advantageIdByName: Map<string, number>;
}

/** Every saved fixture (tests/fixtures/draft-N.json), as seasons */
export function fixtureSeasons(): FixtureSeason[] {
  const fixtures: { draftId: number; events: EventRow[] }[] = [];
  for (const entry of Deno.readDirSync(FIXTURES)) {
    const match = entry.name.match(/^draft-(\d+)\.json$/);
    if (!match) continue;
    const { events } = JSON.parse(Deno.readTextFileSync(new URL(entry.name, FIXTURES))) as { events: EventRow[] };
    fixtures.push({ draftId: Number(match[1]), events });
  }
  const eventTypes = eventTypesIn(fixtures.flatMap(f => f.events));
  return fixtures.map(f => ({ draftId: f.draftId, ...seasonFromRows(f.events, eventTypes) }))
    .sort((a, b) => a.draftId - b.draftId);
}

function eventTypesIn(events: EventRow[]): Map<string, EventType> {
  const eventTypes = new Map<string, EventType>();
  for (const e of events) {
    if (eventTypes.has(e.event)) continue;
    eventTypes.set(e.event, {
      id: eventTypes.size + 1, category: e.category, name: e.event, changesTribe: e.changes_tribe,
      endsGame: e.ends_game, advantageEffect: e.advantage_effect, points: 0,
    });
  }
  return eventTypes;
}

export function seasonFromRows(
  events: EventRow[],
  eventTypes = eventTypesIn(events),
): Omit<FixtureSeason, "draftId"> {
  const data: SeasonData = {
    season: events[0].season,
    castawayById: new Map(events.map(e => [e.castaway_id, {
      id: e.castaway_id, firstName: e.castaway_first_name, lastName: e.castaway_last_name,
      name: `${e.castaway_first_name} ${e.castaway_last_name}`, nickname: null,
    }])),
    tribeById: new Map(events.filter(e => e.tribe_id !== null)
      .map(e => [e.tribe_id!, { id: e.tribe_id!, name: e.tribe!, color: e.tribe_color ?? "" }])),
    eventTypeByName: eventTypes,
    advantageById: new Map(events.filter(e => e.advantage_id !== null)
      .map(e => [e.advantage_id!, { id: e.advantage_id!, name: e.advantage! }])),
  };
  return {
    events,
    data,
    tribeIdByName: new Map([...data.tribeById.values()].map(t => [t.name, t.id])),
    advantageIdByName: new Map([...data.advantageById.values()].map(a => [a.name, a.id])),
  };
}
