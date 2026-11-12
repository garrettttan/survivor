# Survivor Fantasy Draft

A website for running a fantasy league around *Survivor*. Before a season starts, players draft teams of castaways
and each pick who they think will win. As episodes air, an admin enters what happened: challenges, votes, idols,
swaps, quits, medevacs and the final tribal council. Each team scores points from what its castaways do. The site
shows the standings, how they changed over time, and every castaway's history.

The site is live at <https://garrettttan.github.io/survivor/>. It covers seasons 47 to 51. Add `?season=N` to the
URL to open a different season.

## What's on the site

**Public site (`index.html`)**

- **Standings**: each team's points, how many of its castaways are still in the game, and whether its winner pick is
  still alive (or, once the season is over, whether that pick won).
- **Chart**: each team's running points after every episode. A toggle switches it to each team's place.
- **Overview**: every castaway in a table you can sort by name, tribe, points, team or status. It can show only the
  castaways still in the game.
- **Recap**: one episode at a time: who went home, any swap or merge, each team's points, then the challenges,
  votes, advantages and moments in the order they happened.
- **Scoring**: the point value for each kind of event that season, grouped by category.
- **Castaway panel**: tap a castaway to see their tribe history, a log of events by episode (including tribe
  changes and 0-point events), the advantages they hold or have used, and their points. Tap a
  name inside the panel to open that castaway, and Back takes you to the one before.

**Admin page (`admin.html`)**

Signed-in admins can open **Edit events** from the site's header. An episode is entered as a list of *cards*. Each
card is one thing that happened:

| Card | Covers |
| --- | --- |
| Tribe change | a swap, one castaway moving tribes, the merge, starting tribes |
| Challenge | immunity and/or reward, won by a tribe, an individual or ad-hoc teams, plus who sat out and who went on the reward |
| Tribal council | votes, who was safe (immunity, idol, Shot in the Dark), and who went home (voted out, rock draw, consensus), and pairs when castaways vote in pairs (each votes for a pair, and a pair goes home) |
| Advantage | found, given away, played (and whether it changed the result), expired |
| Exit | medevac, quit, lost at fire-making |
| Moment | iconic moments and crying, with a note |
| Final tribal council | each juror's vote |

While you edit, the page checks the cards in the background. It shows errors on each card and a panel with the
current state of the game: who's on which tribe and who holds which advantage. You can also reopen an episode that's
already been entered. Before you save, the page shows what your change would do to that episode and to every
episode after it. Saving replaces all of them in a single transaction.

## How it works

```
 Browser (static HTML/JS on GitHub Pages)
   │
   ├─ index.html ──► get-drafts       ──► drafts (for the season picker)
   │             ├─► get-draft-data   ──► teams, rosters, events, scoring, castaways
   │             │                         └─ replays events → standings JSON
   │             └─► get-episode-recap ─► one episode's cards (stored, or rebuilt from its rows) → recap items
   │
   └─ admin.html ──► episode-entry    ──► cards → events rows, checks, saves
                                           (insert_episode_events / replace_episodes)
 Supabase: Postgres + Auth + Edge Functions (Deno)
```

### Frontend

The frontend is plain HTML, CSS and JavaScript with no build step. Scripts load in order through `defer` tags, and
two libraries come from a CDN: Chart.js and supabase-js. `config.js` holds the Supabase URL, the publishable key,
and the season to show when the URL doesn't name one.

| Folder | Contents |
| --- | --- |
| `js/api/` | Calls to Supabase and sign-in. No DOM code. |
| `js/shared/` | Helpers, the color palette and the sign-in form, used by both pages |
| `js/site/` | The public page's sections (standings, chart, overview, castaway panel), its badges and team colors, and `app.js`, which starts the page |
| `js/admin/` | The admin page: form state (`admin.js`) and the card forms (`admin-cards.js`) |
| `css/` | `styles.css` for both pages, `admin.css` for the admin page |
| `logos/` | Each season's logo |

### Data model

The database stores **events** and computes everything else from them. An event row is one thing that happened to one
castaway in one episode, in order (`seq`). It has an event type and can also carry a tribe, another castaway (for
example, who they voted for), an advantage, a quantity and details. Event types include flags for when an event
changes someone's tribe, ends their game, or gains or loses an advantage. Code refers to an event type only by its id
(`supabase/functions/_shared/event-types.ts`), never by its name, so an event type can be renamed freely. A new event
type is inserted by a migration with a fixed id (`overriding system value`) and added to that file.

Other tables: `castaways`, `tribes`, `advantages`, `event_types`, `scoring` (points per event type per season),
`drafts`, `teams` (with a winner pick and a ghost count) and the rosters that link teams to castaways. The views
`events_readable`, `season_events_readable` and `rosters_readable` join these tables into rows that are easier to read.
`episode_cards` stores the cards each episode was entered from, so the episode can be reopened for editing.

### Scoring (`get-draft-data`)

`_shared/replay.ts` plays a season's events in order. For each castaway it builds their tribe history, advantages,
event log, points per episode, and how their game ended. `get-draft-data` adds up each team's castaways per episode.
It then computes running totals and places (tied teams share a place). It also reports whether the season has
merged and whether it's finished.

**Ghosts**: a team with fewer castaways than the others can have a `ghost_count`. Each ghost adds the team's
per-member average for that episode, so smaller teams aren't penalized.

### Episode entry (`episode-entry`)

The browser only collects cards. All the rules run in the edge function:

- `cards.ts` turns cards into event rows and checks them. For example, every remaining castaway must be placed in a
  swap, and voters must be at that tribal. Each vote at Tribal also gives whoever it was for a Received a vote row
  (Received a nullified vote if they were safe), pointing back at the voter; these come after all of that Tribal's
  votes, in order of the voter's name.
- `game.ts` tracks the game as it stands before each card.
- `edit.ts` replays an edited episode and every episode after it, and reports what changed.
- `rebuild.ts` rebuilds cards from saved rows for episodes that have none stored, such as older seasons first entered
  in the Table Editor.

Actions: `state`, `preview`, `save` (a new episode) and `replace` (an edit).

### Episode recap (`get-episode-recap`)

Returns one episode as the cards it was entered from, turned into recap items in order (`recap.ts`): a challenge with
its winners, a Tribal with its votes and who was safe, an advantage given from one castaway to another, and so on. An
episode with no stored cards gets them rebuilt from its rows, using `episode-entry`'s code. A row no card describes
comes back as a plain event under its event type's category. The site only draws the items.

### Security

Anyone can read, including `episode_cards` (for the recap). Writes go through Row Level Security policies that allow them only for users whose
`app_metadata.role` is `"admin"`. `episode-entry` checks the caller's role. It reads and saves as that user, so the
same policies apply. Season setup and scoring are edited in the Supabase Table Editor and can't be changed through
the API.

## Development

**Run the site locally**: serve the repo root with any static server. `episode-entry` accepts requests from
localhost.

```sh
python3 -m http.server
# open http://localhost:8000/?season=51
```

The local site talks to the live Supabase project in `config.js`.

**Tests** (Deno): the replay, card rules, rebuild and edit logic are tested against fixtures saved from every real
season.

```sh
deno test --allow-read=supabase/functions supabase/functions/tests/

# Refresh fixtures from the live project (read-only, uses the publishable key)
deno run --allow-net --allow-write=supabase/functions/tests/fixtures supabase/functions/tests/fetch-fixtures.ts

# Re-record expected replay output (only when a change to the results is intended; review the diff)
deno run --allow-read=supabase/functions --allow-write=supabase/functions/tests/fixtures supabase/functions/tests/record-expected.ts
```

The SQL tests in `supabase/tests/` check the RLS policies and the save functions. Run them in the SQL editor. They
roll back when they finish.

## Deployment

- **Site**: GitHub Pages serves the repo.
- **Backend**: `supabase/config.toml` is set up for Supabase's GitHub integration. A push to `main` applies new
  migrations in `supabase/migrations/` and deploys the edge functions listed in that file.
