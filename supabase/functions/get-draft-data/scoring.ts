// The scoring rules as the site's Scoring tab shows them: grouped by category, 0-point rules left out.

/** The event type embedded in a scoring row. */
export interface EventTypesRow {
  name: string;
  category: string;
  description: string | null;
}

/** One row of the scoring query in index.ts: an event type and its points this season. */
export interface ScoringRow {
  points: number;
  event_types: EventTypesRow;
}

/** One rule on the Scoring tab. */
export interface ScoringItem {
  name: string;
  description: string | null;
  points: number;
}

/** Category → its rules, in the order given. Rules worth 0 points are left out. */
export function parseScoring(scoring: ScoringRow[]): Record<string, ScoringItem[]> {
  const categories: Record<string, ScoringItem[]> = {};
  for (const s of scoring) {
    if (Number(s.points) === 0) continue;
    const { name, description, category } = s.event_types;
    (categories[category] ??= []).push({ name, description, points: s.points });
  }
  return categories;
}
