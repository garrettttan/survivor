// API: thin wrappers over the episode-entry edge function, which holds every rule for turning cards into
// events rows. The page sends what happened (cards, as castaway and tribe ids) and renders what comes back.
//
// Shapes the function returns:
//   GameState  { tribeOf: { [castawayId]: tribeId }, out: [castawayId], held: { [castawayId]: [{ id, name }] } }
//              (out is in the order they left the game)
//              (a held advantage's id is null while it's a new one from an earlier card, not saved yet)
//   Row        { card, seq, castawayId, eventType, otherCastawayId, advantage, tribeId, quantity, details, points }
//              (card = index of the card that makes it; eventType = its name; advantage = an id, or a new one's name)
//   Error      { card?, message } (no card = about the whole episode)
//
//   PageRow    { castawayId, eventType, otherCastawayId, advantage, tribeId, quantity, details, points }
//   Changes    { added: [PageRow], removed: [PageRow] } (an episode's new rows against its saved ones, seq aside)
//
// Card shapes are listed in js/admin/admin-cards.js. Wherever a card names an advantage, it's a number
// (advantages.id) or a string (the name of a new advantage, created on save).

// Calls the function as the signed-in admin (functions.invoke attaches the session). A 400 with `errors` is a
// validation result, not a failure, so it comes back like a success; anything else throws.
async function callEpisodeEntry(body) {
  const { data, error } = await authClient.functions.invoke('episode-entry', { body });
  if (!error) return data;
  const details = await error.context?.json?.().catch(() => null);
  if (details?.errors) return details;
  throw new Error(details?.error || error.message);
}

// Everything the form needs for `episode` (null = the one after the last entered), with the game as it stood
// when the episode began:
// { episode, castaways: [{ id, name, firstName, nickname }], tribes: [{ id, name, color }], eventTypes: [{ id, name, points }],
//   advantages: [{ id, name }], maxEpisode, game: GameState, cards, rebuilt, fallbacks: [{ seq, castawayId, event }] }
// (maxEpisode = the highest episode with rows, 0 for none; cards = an entered episode's cards, null for a new one;
// rebuilt = no cards were stored, so they were rebuilt from its rows, and fallbacks are the rows that became custom
// cards)
function getEpisodeState(season, episode) {
  return callEpisodeEntry({ action: 'state', season, episode });
}

// What saving `cards` would do, checked but not written: { rows: [Row], errors: [Error], warnings: [string],
// states: [GameState] } (rows = the events rows they'd make, shown under the card that makes each; states has one
// more entry than cards: states[i] = the game just before card i, the last = after every card).
// Editing an entered episode (edit = true) adds changes: Changes for the episode, and later: [{ episode, errors:
// [Error], changes: Changes }] for every episode after it, replayed from its own cards after the edit.
function previewEpisode(season, episode, cards, edit = false) {
  return callEpisodeEntry({ action: 'preview', season, episode, cards, edit });
}

// Writes a new episode: the preview's checks again, then one transaction. { inserted } or { errors: [Error] }.
function saveEpisode(season, episode, cards) {
  return callEpisodeEntry({ action: 'save', season, episode, cards });
}

// Writes an edit to an entered episode, and every later episode whose rows it changes, in one transaction:
// { replaced, episodes: [number] } (episodes = the ones written, the edited one first) or { errors: [Error] }
// (nothing written; an error in a later episode starts with "Episode N, card M:")
function replaceEpisode(season, episode, cards) {
  return callEpisodeEntry({ action: 'replace', season, episode, cards });
}
