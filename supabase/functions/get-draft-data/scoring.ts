/** The nested event_types object. */
export interface EventTypesRow {
  name: string;
  category: string;
  description: string | null;   // nullable in the database, so it can be null
}

export interface ScoringRow {
  points: number;
  event_types: EventTypesRow;   // a field whose value is another object
}

export interface ScoringItem {
  name: string;
  description: string | null;
  points: number; 
}

export function parseScoring(scoring: ScoringRow[]): Record<string, ScoringItem[]> {
  const categories: Record<string, ScoringItem[]> = {};

  for (const s of scoring) {
    if (s.points == 0) {
      continue;
    } 

    const item: ScoringItem = {
      name: s.event_types.name,
      description: s.event_types.description,
      points: s.points, 
    };

    const category = s.event_types.category;
    if (category in categories) {
      categories[category].push(item); 
    } else {
      categories[category] = [item];
    }
  }

  return categories;
};
