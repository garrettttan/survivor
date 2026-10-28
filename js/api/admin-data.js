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
// Card shapes are listed in js/admin/admin-cards.js. Wherever a card names an advantage, it's a number
// (advantages.id) or a string (the name of a new advantage, created on save). Editing an episode that's already
// entered isn't supported yet.

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
// { episode, castaways: [{ id, name, firstName }], tribes: [{ id, name, color }], eventTypes: [{ id, name, points }],
//   advantages: [{ id, name }], maxEpisode, game: GameState }
// (maxEpisode = the highest episode with rows, 0 for none)
function getEpisodeState(season, episode) {
  return callEpisodeEntry({ action: 'state', season, episode });
}

// What saving `cards` would do, checked but not written: { rows: [Row], errors: [Error], warnings: [string],
// states: [GameState] } (rows = the events rows they'd make, shown under the card that makes each; states has one
// more entry than cards: states[i] = the game just before card i, the last = after every card)
function previewEpisode(season, episode, cards) {
  return callEpisodeEntry({ action: 'preview', season, episode, cards });
}

// Writes the episode: the preview's checks again, then one transaction. { inserted } or { errors: [Error] }.
function saveEpisode(season, episode, cards) {
  return callEpisodeEntry({ action: 'save', season, episode, cards });
}
