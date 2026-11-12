// Short display names, as the site shows them: a port of shortNames() in js/shared/util.js. Keep the two the same:
// text the functions save for the site to show (a pair vote's "Kilby & Kristin") has to match the names it shows
// everywhere else. The migration 20261113140000_pair_vote_short_names.sql applies the same rule in SQL.
//
// The castaway's nickname (e.g. "Jelly") if set, else their first name (e.g. "Thien An"), else the first word of
// their name. Adds a last initial when short names clash ("John A.", "John C."), and the full name if that still
// clashes.

export interface NamedCastaway {
  name: string;                                  // full name
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
}

/** Full name → short name, for a season's castaways */
export function shortNames(castaways: Iterable<NamedCastaway>): Map<string, string> {
  const parts = new Map<string, { base: string; initialed: string }>();
  for (const { name, firstName, lastName, nickname } of castaways) {
    if (parts.has(name)) continue;
    const words = name.trim().split(/\s+/);
    const base = nickname || firstName || words[0];
    // Last name if known, else what follows the short name ("Thien An Nguyen" → "Nguyen"), or the words after the first
    const rest = lastName || (name.startsWith(base) ? name.slice(base.length).trim() : words.slice(1).join(" "));
    parts.set(name, { base, initialed: rest ? `${base} ${rest[0]}.` : base });
  }
  const counts = (key: "base" | "initialed") =>
    [...parts.values()].reduce((m, p) => m.set(p[key], (m.get(p[key]) ?? 0) + 1), new Map<string, number>());
  const baseCounts = counts("base"), initialedCounts = counts("initialed");
  return new Map([...parts].map(([name, p]) => [name,
    baseCounts.get(p.base) === 1 ? p.base : initialedCounts.get(p.initialed) === 1 ? p.initialed : name]));
}
