// Admin page: the episode entry page's card forms. Loaded before admin.js, which keeps the list of cards.
// Forms only: each renders inputs from a card object and copies inputs back into it. No rules; the
// episode-entry function decides what rows a card makes and whether it's valid.
//
// Card shapes, as sent to the function (ids are castaway, tribe or advantage ids):
//   tribeChange  { kind: 'swap', moves: { [castawayId]: tribeId } } (everyone still in the game must be placed,
//                including anyone who stays on the tribe they were on)
//                { kind: 'move', castawayId, tribeId } (one castaway changes tribe on their own)
//                { kind: 'merge', tribeId } (everyone still in the game joins tribeId)
//                { kind: 'start', moves: { [castawayId]: tribeId | null } } (starting tribes, which come from a CSV:
//                shown when editing an episode that has them, never offered for a new card; null = no tribe)
//   challenge    { prize: 'immunity'|'reward'|'both', format: 'tribe'|'individual'|'teams', first, second,
//                  teamCount, teams: { [castawayId]: teamNumber }, satOut: [id], broughtOnReward: [id] }
//                  (tribe: first/second = tribe ids; individual: first = a castaway id; teams, for teams that aren't
//                  tribes: teamCount teams numbered from 1, teams = who was on each, first/second = team numbers;
//                  anyone still in the game who isn't on a team sat out)
//   tribal       { tribeId, votes: { [voterId]: targetId | 'none' | 'shot' }, outcome: 'voted'|'rocks'|'consensus', bootId,
//                  safe: { [castawayId]: 'immunity' | 'idol' | 'shot' }, pairs: { [castawayId]: pairNumber } }
//                  ('shot' as a vote = played Shot in the Dark instead of voting; safe = who couldn't go home, and why;
//                  pairs = who was paired with whom when castaways voted in pairs, else empty: a vote, and bootId, then
//                  name the pair's first member and stand for the whole pair)
//   advantage    { action: 'found'|'gave'|'played'|'expired', castawayId, advantage, recipientId, targetId,
//                  changedOutcome } (played: targetId = who it was played on, null when they played it for themselves)
//   exit         { reason: 'medevac'|'quit'|'fire', castawayId }
//   moment       { kind: 'iconic'|'cried', castawayId, note }
//   ftc          { votes: { [jurorId]: finalistId } } (the finalists are everyone still in the game at this card;
//                anyone out who isn't listed wasn't on the jury)
//   custom       { eventType, castawayId, otherCastawayId, advantage, tribeId, quantity, details }
// Every card also carries `type`. Keys starting with "_" are form-only: dropped by cardPayload(), and filled back in
// by loadCard() when an entered episode's cards are opened.
//
// A form is drawn from `ctx`: getEpisodeState's reply (castaways, tribes, advantages, eventTypes, …) with `game` set
// to the GameState just before this card, plus `short`: Map of castaway id → short name. Cards are only changed by
// their inputs (applyInput, with the same ctx), never while drawing.

const CARD_TYPES = {
  tribeChange: {
    label: 'Tribe change',
    blank: () => ({ kind: 'swap', moves: {}, castawayId: null, tribeId: null }),
    html: tribeChangeHtml,
    reset: { kind: { moves: {}, castawayId: null, tribeId: null }, castawayId: { tribeId: null } },
  },
  challenge: {
    label: 'Challenge',
    blank: () => ({ prize: 'immunity', format: 'tribe', first: null, second: null, teamCount: 2, teams: {}, satOut: [], broughtOnReward: [] }),
    html: challengeHtml,
    reset: {
      format: { first: null, second: null, teams: {}, satOut: [], broughtOnReward: [] },
      prize: { broughtOnReward: [] },
      first: { second: null },
    },
    // Teams: fewer teams drops anyone on a team that's gone and the places it held, and whoever isn't on a team
    // sat out. Anyone who now won the reward is no longer someone brought on it.
    tidy: (card, ctx) => {
      if (card.format === 'teams') {
        card.teams = Object.fromEntries(Object.entries(card.teams).filter(([, n]) => n <= card.teamCount));
        if (card.first > card.teamCount) card.first = null;
        if (card.second > card.teamCount || card.teamCount < 3) card.second = null;
        card.satOut = unsortedIds(card, ctx);
      }
      const winners = rewardWinners(card, ctx);
      card.broughtOnReward = (card.broughtOnReward || []).filter(id => !winners.includes(id));
    },
  },
  tribal: {
    label: 'Tribal Council',
    // With one tribe in play (after the merge), it's the one at Tribal
    blank: ctx => {
      const tribes = tribesInPlay(ctx);
      const card = { tribeId: tribes.length === 1 ? tribes[0].id : null, votes: {}, outcome: 'voted', bootId: null,
        safe: {}, pairs: {}, _paired: false, _votesFor: null, _wentHomeFor: null, _immunityFilled: false };
      prefillImmunity(card, ctx);
      return card;
    },
    html: tribalHtml,
    // A saved card's votes and who was safe are as entered, so nothing is prefilled over them (cards saved before
    // safety was recorded have none)
    load: card => {
      const pairs = card.pairs ?? {};
      const loaded = { ...card, pairs };
      return { pairs, _paired: Object.keys(pairs).length > 0, _votesFor: card.bootId,
        _wentHomeFor: card.bootId === null ? null : wentHomeKey(loaded, card.bootId), safe: card.safe ?? {}, _immunityFilled: true };
    },
    reset: { tribeId: { votes: {}, bootId: null, pairs: {}, safe: {}, _votesFor: null, _wentHomeFor: null,
      _immunityFilled: false } },
    // Rocks takes no votes, so they're cleared (and filled in again if the outcome changes back). Only someone at
    // this Tribal can be safe at it, and only someone who played Shot in the Dark can have been saved by it.
    tidy: (card, ctx) => {
      tidyPairs(card, ctx);
      if (card.outcome === 'rocks') Object.assign(card, { votes: {}, _votesFor: null });
      else if (card.tribeId !== null) prefillVotes(card, membersOf(card.tribeId, ctx));
      prefillImmunity(card, ctx);
      const attendees = card.tribeId === null ? [] : membersOf(card.tribeId, ctx);
      card.safe = Object.fromEntries(Object.entries(card.safe || {}).filter(([id, reason]) =>
        attendees.includes(Number(id)) && (reason !== 'shot' || card.votes[id] === 'shot')));
    },
  },
  advantage: {
    label: 'Advantage',
    blank: () => ({ action: 'found', castawayId: null, advantage: null, recipientId: null, targetId: null, changedOutcome: false, _advantagePick: null }),
    html: advantageHtml,
    // A saved Found card picked an advantage by id; a name is one first found in this card, not saved yet
    load: card => ({
      _advantagePick: card.action !== 'found' || card.advantage == null ? null
        : typeof card.advantage === 'number' ? card.advantage : '__new__',
    }),
    reset: {
      action: { castawayId: null, advantage: null, _advantagePick: null, recipientId: null, targetId: null },
      castawayId: { advantage: null, _advantagePick: null, targetId: null },
    },
    // A found advantage is picked from the list (`_advantagePick`), or "New advantage…" and a name typed in the box
    tidy: card => {
      if (card.action !== 'found') return;
      card.advantage = card._advantagePick === '__new__' ? (typeof card.advantage === 'string' ? card.advantage : null) : card._advantagePick;
    },
  },
  exit: { label: 'Exit', blank: () => ({ reason: 'medevac', castawayId: null }), html: exitHtml },
  moment: { label: 'Moment', blank: () => ({ kind: 'iconic', castawayId: null, note: '' }), html: momentHtml },
  ftc: { label: 'Final Tribal', blank: () => ({ votes: {} }), html: ftcHtml },
  custom: {
    label: 'Custom row',
    blank: () => ({ eventType: null, castawayId: null, otherCastawayId: null, advantage: null, tribeId: null, quantity: null, details: '' }),
    html: rowFieldsHtml,
  },
};

// A new card; `ctx` is the game it starts from
function newCard(type, ctx) {
  return { type, ...CARD_TYPES[type].blank(ctx) };
}

// A card as the function sends it (an entered episode's, or a saved draft's), ready for its form: the fields the
// form keeps for itself (starting with "_") are filled back in
function loadCard(card) {
  return { ...card, ...CARD_TYPES[card.type]?.load?.(card) };
}

// The card as the function takes it
function cardPayload(card) {
  return Object.fromEntries(Object.entries(card).filter(([k]) => !k.startsWith('_')));
}

// ── Reading inputs ────────────────────────────────────────────────────────
// Inputs say where their value goes with data attributes:
//   data-field="x"            target.x = the value
//   data-list="x"             a checkbox that adds or removes its value in the array target.x
//   data-map="x" data-key="k" target.x[k] = the value (a blank value removes k)
//   data-assign="x" data-key="k"  a checkbox that sets target.x[k] to its value when ticked and removes k when
//                             unticked
//   data-num                  numeric ids and counts become numbers
//   data-rerender             the form changes shape, so the page redraws the card
// A blank value is null. A plain checkbox's value is whether it's ticked; a radio only reports when picked.
function parseValue(el) {
  if (el.value === '') return null;
  return el.dataset.num !== undefined && /^-?\d+(\.\d+)?$/.test(el.value) ? Number(el.value) : el.value;
}

// Copies one input into a card, then lets the card type tidy up (`ctx` is the game just before the card)
function applyInput(card, el, ctx) {
  const { field, list, map, assign, key } = el.dataset;
  if (assign) {
    card[assign] = { ...card[assign] };
    if (el.checked) card[assign][key] = parseValue(el);
    else delete card[assign][key];
  } else if (list) {
    const value = parseValue(el);
    card[list] = el.checked ? [...new Set([...card[list], value])] : card[list].filter(v => v !== value);
  } else if (map) {
    const value = parseValue(el);
    card[map] = { ...card[map] };
    if (value === null) delete card[map][key];
    else card[map][key] = value;
  } else {
    card[field] = el.type === 'checkbox' ? el.checked : parseValue(el);
  }
  // Fields that depend on the one that changed start over
  Object.assign(card, CARD_TYPES[card.type].reset?.[field]);
  CARD_TYPES[card.type].tidy?.(card, ctx);
}

// ── Game state helpers ────────────────────────────────────────────────────
// Castaway ids sorted by short name
function byShortName(ids, ctx) {
  return [...ids].sort((a, b) => (ctx.short.get(a) || '').localeCompare(ctx.short.get(b) || ''));
}

// Castaways still in the game
function activeIds(ctx) {
  const out = new Set(ctx.game.out);
  return byShortName(ctx.castaways.map(c => c.id).filter(id => !out.has(id)), ctx);
}

// Every castaway in the season, in or out
function allIds(ctx) {
  return byShortName(ctx.castaways.map(c => c.id), ctx);
}

// Castaways still in the game on `tribeId`
function membersOf(tribeId, ctx) {
  return activeIds(ctx).filter(id => ctx.game.tribeOf[id] === tribeId);
}

// Tribes with anyone still in the game on them
function tribesInPlay(ctx) {
  return ctx.tribes.filter(t => membersOf(t.id, ctx).length);
}

// The advantages a castaway holds ([{ id, name }])
function heldBy(castawayId, ctx) {
  return ctx.game.held[castawayId] || [];
}

// A held advantage's value in a picker: its id, or its name while it's still new
function heldValue(adv) {
  return adv.id ?? adv.name;
}

// ── Inputs ────────────────────────────────────────────────────────────────
// Data attributes from { name: value } (true = a bare attribute), as read by applyInput
function attrs(bind) {
  return Object.entries(bind).map(([k, v]) => v === true ? ` data-${k}` : ` data-${k}="${escapeHtml(v)}"`).join('');
}

// <option>s from [value, label] pairs, with a blank first option labelled `blank` (null for none)
function optionsHtml(pairs, selected, blank) {
  const blankHtml = blank === null ? '' : `<option value="">${escapeHtml(blank)}</option>`;
  return blankHtml + pairs.map(([value, label]) =>
    `<option value="${escapeHtml(value)}"${String(value) === String(selected ?? '') ? ' selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
}

// A <select> bound to the card by `bind` (data attributes, see attrs)
function selectHtml(bind, pairs, selected, blank = 'Choose…') {
  return `<select class="entry-input"${attrs(bind)}>${optionsHtml(pairs, selected, blank)}</select>`;
}

// [id, short name] pairs for a select
function castawayPairs(ids, ctx) {
  return ids.map(id => [id, ctx.short.get(id)]);
}

// A select of castaways, its value a number
function castawaySelect(field, ids, selected, ctx, extra = {}) {
  return selectHtml({ field, num: true, ...extra }, castawayPairs(ids, ctx), selected);
}

// [id, name] pairs for a select
function tribePairs(tribes) {
  return tribes.map(t => [t.id, t.name]);
}

// One checkbox chip per castaway, ticked when its id is in `selected`
function checkChipsHtml(list, ids, selected, ctx, extra = {}) {
  if (!ids.length) return '<span class="empty-note">No one</span>';
  return `<div class="entry-chips">${ids.map(id => `
    <label class="entry-chip"><input type="checkbox" value="${id}"${attrs({ list, num: true, ...extra })}${selected.includes(id) ? ' checked' : ''}>
      <span>${escapeHtml(ctx.short.get(id))}</span></label>`).join('')}</div>`;
}

// A labelled single input
function fieldHtml(label, control) {
  return `<label class="entry-field"><span class="entry-label">${escapeHtml(label)}</span>${control}</label>`;
}

// A labelled group for controls that aren't one input (checkbox chips, per-castaway rows)
function groupHtml(label, inner) {
  return `<div class="entry-field"><span class="entry-label">${escapeHtml(label)}</span>${inner}</div>`;
}

// One button per tribe in its color (picked: filled), so tribes can be told apart at a glance. Radios
// underneath, read like any other input; each call gets its own group name. `noneLabel` adds a plain pill that
// clears the choice, for optional pickers.
let tribeChoiceGroups = 0;
function tribeChoicesHtml(bind, tribes, selected, noneLabel = null) {
  const name = `tribe-choice-${++tribeChoiceGroups}`;
  const pill = (value, label, color, checked) => `<label class="entry-chip entry-tribe-choice" style="${tribeStyleVars(color, 0.12)}">
      <input type="radio" name="${name}" value="${value}"${attrs(bind)}${checked ? ' checked' : ''}>
      <span>${escapeHtml(label)}</span></label>`;
  const pills = tribes.map(t => pill(t.id, t.name, t.color, t.id === selected));
  if (noneLabel !== null) pills.push(pill('', noneLabel, null, selected == null));
  return `<div class="entry-chips">${pills.join('')}</div>`;
}

// ── Card forms ────────────────────────────────────────────────────────────
// Each takes a card and the ctx it's drawn from, and returns its inputs' HTML.

// Tribe change: a swap, one castaway switching, the merge, or starting tribes
function tribeChangeHtml(card, ctx) {
  // Starting tribes come from the CSV, so this kind is only ever an existing card and can't be switched to or from.
  // Castaways not on a tribe yet are sorted onto one, or onto "No tribe" if they started without one.
  if (card.kind === 'start') {
    const ids = activeIds(ctx).filter(id => ctx.game.tribeOf[id] === undefined);
    return '<p class="entry-hint">Starting tribes, from the CSV.</p>' +
      sortIntoGroupsHtml('moves', [...ctx.tribes, { id: null, name: 'No tribe', color: null }], card, ctx, ids);
  }
  const kind = fieldHtml('Type', selectHtml({ field: 'kind', rerender: true },
    [['swap', 'Swapped tribes'], ['move', 'Switched Tribes'], ['merge', 'Merged']], card.kind, null));
  if (card.kind === 'move') {
    const from = card.castawayId === null ? null : ctx.game.tribeOf[card.castawayId];
    return kind + fieldHtml('Castaway', castawaySelect('castawayId', activeIds(ctx), card.castawayId, ctx, { rerender: true })) +
      groupHtml('New tribe', tribeChoicesHtml({ field: 'tribeId', num: true }, ctx.tribes.filter(t => t.id !== from), card.tribeId));
  }
  if (card.kind === 'merge') {
    return kind + groupHtml('Merged tribe', tribeChoicesHtml({ field: 'tribeId', num: true }, ctx.tribes, card.tribeId));
  }
  // A swap, tribe by tribe; everyone still in the game has to be placed
  return kind + sortIntoGroupsHtml('moves', ctx.tribes, card, ctx);
}

// Sorting castaways into groups (tribes in a swap, teams in a challenge), group by group: each group in its color
// lists everyone still in the game, and tapping a castaway puts them in that group (tapping again takes them out).
// Castaways in another group are dimmed so the unsorted ones stand out. `assign` is the card's map of castaway id
// → group id; groups are [{ id, name, color }] (a null id is a group for "none"); `ids` are the castaways to sort
// (default: everyone still in).
function sortIntoGroupsHtml(assign, groups, card, ctx, ids = activeIds(ctx)) {
  const blocks = groups.map(g => {
    const placed = ids.filter(id => card[assign][id] === g.id);
    const chips = ids.map(id => {
      const here = card[assign][id] === g.id;
      const elsewhere = !here && card[assign][id] !== undefined;
      return `<label class="entry-chip entry-swap-chip${elsewhere ? ' elsewhere' : ''}">
        <input type="checkbox" value="${g.id ?? ''}" data-assign="${assign}" data-key="${id}" data-num data-rerender${here ? ' checked' : ''}>
        <span>${escapeHtml(ctx.short.get(id))}</span></label>`;
    }).join('');
    return `<div class="entry-tribe" style="${tribeStyleVars(g.color)}">
      <div class="entry-tribe-name">${escapeHtml(g.name)} · ${placed.length}</div>
      <div class="entry-chips">${chips}</div>
    </div>`;
  }).join('');
  return `<div class="entry-field entry-swap">${blocks}</div>`;
}

// Teams that aren't tribes, numbered from 1, each in its own palette color (colors.js)
function challengeTeams(card) {
  return Array.from({ length: card.teamCount }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}`, color: PALETTE[i % PALETTE.length] }));
}

// 1st place, and 2nd when three or more groups (tribes or teams) competed, as colored pills
function placesHtml(card, groups) {
  let html = groupHtml('1st place', tribeChoicesHtml({ field: 'first', num: true, rerender: true }, groups, card.first));
  if (groups.length >= 3) {
    html += groupHtml('2nd place', tribeChoicesHtml({ field: 'second', num: true }, groups.filter(g => g.id !== card.first), card.second, 'None'));
  }
  return html;
}

// Castaways still in the game who aren't on a team: in a team challenge, they sat out
function unsortedIds(card, ctx) {
  return activeIds(ctx).filter(id => card.teams[id] == null);
}

// How many teams, who was on each, then their places, then who sat out: everyone not put on a team. Teams can be
// as small as pairs, so there can be up to half as many teams as castaways still in the game.
function teamPlacesHtml(card, ctx) {
  const teams = challengeTeams(card);
  const maxTeams = Math.max(2, Math.floor(activeIds(ctx).length / 2), card.teamCount);
  const counts = Array.from({ length: maxTeams - 1 }, (_, i) => [i + 2, String(i + 2)]);
  const unsorted = unsortedIds(card, ctx);
  const satOut = unsorted.length
    ? `<div class="entry-chips">${unsorted.map(id => `<span class="entry-member">${escapeHtml(ctx.short.get(id))}</span>`).join('')}</div>`
    : '<span class="empty-note">No one</span>';
  return fieldHtml('Number of teams', selectHtml({ field: 'teamCount', num: true, rerender: true }, counts, card.teamCount, null)) +
    sortIntoGroupsHtml('teams', teams, card, ctx) +
    placesHtml(card, teams) +
    groupHtml('Sat out (anyone not on a team)', satOut);
}

// Challenge: the prize and format, who won, who sat out, and who an individual reward winner brought along
function challengeHtml(card, ctx) {
  const individual = card.format === 'individual';
  const teams = card.format === 'teams';
  let html = `<div class="entry-row">
    ${fieldHtml('Prize', selectHtml({ field: 'prize', rerender: true },
      [['immunity', 'Immunity'], ['reward', 'Reward'], ['both', 'Immunity + reward']], card.prize, null))}
    ${fieldHtml('Format', selectHtml({ field: 'format', rerender: true },
      [['tribe', 'Tribe'], ['individual', 'Individual'], ['teams', 'Teams']], card.format, null))}
  </div>`;
  if (teams) {
    html += teamPlacesHtml(card, ctx);
  } else if (individual) {
    html += fieldHtml('1st place', castawaySelect('first', activeIds(ctx), card.first, ctx, { rerender: true }));
  } else {
    html += placesHtml(card, tribesInPlay(ctx));
  }
  // A team challenge lists its sit-outs itself (whoever isn't on a team)
  if (!teams) html += groupHtml('Sat out', checkChipsHtml('satOut', activeIds(ctx), card.satOut, ctx));
  // Any reward: the winners can bring others along (anyone still in who didn't win it, e.g. from a losing tribe)
  if (card.prize !== 'immunity') {
    const winners = rewardWinners(card, ctx);
    const others = activeIds(ctx).filter(id => !winners.includes(id));
    html += groupHtml('Brought on reward', checkChipsHtml('broughtOnReward', others, card.broughtOnReward, ctx));
  }
  return html;
}

// Who won 1st place in a challenge: the individual winner, or the winning tribe or team (less anyone who sat out)
function rewardWinners(card, ctx) {
  if (card.first === null || card.first === undefined || card.first === '') return [];
  if (card.format === 'individual') return [card.first];
  if (card.format === 'teams') {
    return Object.entries(card.teams).filter(([, n]) => n === card.first).map(([id]) => Number(id));
  }
  return membersOf(card.first, ctx).filter(id => !card.satOut.includes(id));
}

// Most votes go to whoever went home, so picking them fills in everyone else's vote. Picking someone else later
// moves the votes that were filled in (or still pointed at the old pick); votes you changed stay. `_votesFor`
// remembers who the votes were filled for. When a pair went home, the boot's partner doesn't vote for their own pair,
// so their filled-in vote is cleared too (`_partnerFor` remembers the partner they were filled for).
function prefillVotes(card, attendees) {
  if (card.bootId === null) return;
  const wentHome = pairOf(card, card.bootId);
  const key = wentHome.join(',');
  if (card._votesFor === card.bootId && card._wentHomeFor === key) return;
  const votes = { ...card.votes };
  for (const id of attendees) {
    if (wentHome.includes(id)) {
      if (votes[id] === card._votesFor || wentHome.includes(votes[id])) delete votes[id];
    } else if (votes[id] === undefined || votes[id] === card._votesFor) {
      votes[id] = card.bootId;
    }
  }
  card.votes = votes;
  card._votesFor = card.bootId;
  card._wentHomeFor = key;
}

// ── Pairs at Tribal ──────────────────────────────────────────────────────────
// When castaways are paired up, each votes on their own but for a pair, and a pair goes home. `pairs` maps each
// castaway at Tribal to a pair number; a pair is named by its first member (lowest id), in votes and in bootId.

// Everyone in a castaway's pair, lowest id first (just them when not voting in pairs, or not in a pair yet)
function pairOf(card, id) {
  const pair = card.pairs?.[id];
  if (pair == null) return [id];
  return Object.keys(card.pairs).map(Number).filter(other => card.pairs[other] === pair).sort((a, b) => a - b);
}

function wentHomeKey(card, bootId) {
  return pairOf(card, bootId).join(',');
}

// Each pair once, as [first member, "Ann & Bea"] for a select, in pair number order
function pairChoices(card, ids, ctx) {
  const seen = new Set();
  return ids.map(id => pairOf(card, id)).sort((a, b) => (card.pairs[a[0]] ?? 0) - (card.pairs[b[0]] ?? 0))
    .filter(pair => !seen.has(pair[0]) && seen.add(pair[0]))
    .map(pair => [pair[0], pair.map(id => ctx.short.get(id)).join(' & ')]);
}

// Not voting in pairs: no pairs. Otherwise only people at Tribal are in pairs, and each vote and who went home name
// their pair's first member (so a vote stays with its pair when the pairs are rearranged).
function tidyPairs(card, ctx) {
  const attendees = card.tribeId === null ? [] : membersOf(card.tribeId, ctx);
  card.pairs = card._paired
    ? Object.fromEntries(Object.entries(card.pairs || {}).filter(([id]) => attendees.includes(Number(id))))
    : {};
  const first = id => pairOf(card, id)[0];
  if (typeof card.bootId === 'number') card.bootId = first(card.bootId);
  card.votes = Object.fromEntries(Object.entries(card.votes || {}).map(([voter, target]) =>
    [voter, typeof target === 'number' ? first(target) : target]));
}

// One numbered pair group per two castaways at Tribal, each in its own palette color
function pairGroups(attendees) {
  return Array.from({ length: Math.max(1, Math.ceil(attendees.length / 2)) },
    (_, i) => ({ id: i + 1, name: `Pair ${i + 1}`, color: PALETTE[i % PALETTE.length] }));
}

// Once the tribe at Tribal is known, whoever won individual immunity earlier in the episode (ctx.immune, since the
// last Tribal) is marked safe with it. Only once, so unmarking someone sticks.
function prefillImmunity(card, ctx) {
  if (card._immunityFilled || card.tribeId === null) return;
  const attendees = membersOf(card.tribeId, ctx);
  card.safe = { ...card.safe };
  for (const id of ctx.immune || []) if (attendees.includes(id) && card.safe[id] === undefined) card.safe[id] = 'immunity';
  card._immunityFilled = true;
}

// Tribal Council: the tribe, how it ended, who went home, who was safe, and each castaway's final-round vote
function tribalHtml(card, ctx) {
  let html = groupHtml('Tribe', tribeChoicesHtml({ field: 'tribeId', num: true, rerender: true }, tribesInPlay(ctx), card.tribeId)) +
    fieldHtml('Outcome', selectHtml({ field: 'outcome', rerender: true },
      [['voted', 'Voted out'], ['rocks', 'Went home on rocks'], ['consensus', 'Deadlock consensus']], card.outcome, null));
  if (card.tribeId === null) return html + '<p class="entry-hint">Pick the tribe to choose who went home and enter the votes.</p>';
  const attendees = membersOf(card.tribeId, ctx);
  // Paired up: who's with whom, then the pair that went home, and votes for pairs
  const paired = card._paired;
  html += `<label class="entry-chip"><input type="checkbox"${attrs({ field: '_paired', rerender: true })}${paired ? ' checked' : ''}>
    <span>Voted in pairs</span></label>`;
  if (paired) html += groupHtml('Pairs', sortIntoGroupsHtml('pairs', pairGroups(attendees), card, ctx, attendees));
  const targets = paired ? pairChoices(card, attendees, ctx) : castawayPairs(attendees, ctx);
  html += fieldHtml(paired ? 'Pair that went home' : 'Went home',
    selectHtml({ field: 'bootId', num: true, rerender: true }, targets, card.bootId));
  // Who couldn't go home: immunity or an idol here, Shot in the Dark next to their vote
  html += groupHtml('Safe', sortIntoGroupsHtml('safe',
    [{ id: 'immunity', name: 'Immunity', color: null }, { id: 'idol', name: 'Idol', color: null }],
    { ...card, safe: card.safe || {} }, ctx, attendees));
  if (card.outcome === 'rocks') return html;
  // Shot in the Dark takes the place of a vote; Safe / Not safe appears once it's picked
  const votes = attendees.map(id => `<div class="entry-pair">
      <span class="entry-pair-name">${escapeHtml(ctx.short.get(id))}</span>
      ${selectHtml({ map: 'votes', key: id, num: true, rerender: true },
        [...targets.filter(([t]) => !pairOf(card, id).includes(t)), ['none', 'No vote'], ['shot', 'Shot in the Dark']], card.votes[id])}
      ${card.votes[id] === 'shot' ? shotOutcomeHtml(id, card.safe?.[id] === 'shot') : ''}
    </div>`).join('');
  return html + groupHtml('Final-round votes', voteCountHtml(card, attendees, ctx) + votes);
}

// How a castaway's Shot in the Dark went: Not safe (the default, no safe mark) or Safe (marked safe with it). Radios
// on the card's `safe` map, each pair with its own group name.
let shotChoiceGroups = 0;
function shotOutcomeHtml(id, safe) {
  const name = `shot-choice-${++shotChoiceGroups}`;
  const pill = (value, label, checked) => `<label class="entry-chip">
      <input type="radio" name="${name}" value="${value}" data-map="safe" data-key="${id}" data-rerender${checked ? ' checked' : ''}>
      <span>${label}</span></label>`;
  return `<div class="entry-chips entry-shot-outcome">${pill('', 'Not safe', !safe)}${pill('shot', 'Safe', safe)}</div>`;
}

// How many votes each castaway is getting, most first; anyone without votes is left out
function voteCountHtml(card, attendees, ctx) {
  const counts = new Map();
  attendees.forEach(id => {
    const target = card.votes[id];
    if (typeof target === 'number') counts.set(target, (counts.get(target) || 0) + 1);
  });
  if (!counts.size) return '';
  // A vote for a pair counts against both: "Ann & Bea 3"
  const label = id => pairOf(card, id).map(member => ctx.short.get(member)).join(' & ');
  const tally = [...counts].sort((a, b) => b[1] - a[1] || label(a[0]).localeCompare(label(b[0])))
    .map(([id, n]) => `<span class="entry-vote-count">${escapeHtml(label(id))} <strong>${n}</strong></span>`).join('');
  return `<div class="entry-chips entry-vote-counts">${tally}</div>`;
}

// Advantage: found, given away, played or expired, by whom, and which advantage
function advantageHtml(card, ctx) {
  const holders = activeIds(ctx).filter(id => heldBy(id, ctx).length);
  let html = `<div class="entry-row">
    ${fieldHtml('Action', selectHtml({ field: 'action', rerender: true },
      [['found', 'Found'], ['gave', 'Gave away'], ['played', 'Played'], ['expired', 'Expired']], card.action, null))}
    ${fieldHtml('Castaway', castawaySelect('castawayId', card.action === 'found' ? activeIds(ctx) : holders, card.castawayId, ctx,
      { rerender: true }))}
  </div>`;
  if (card.action === 'found') {
    // Unheld advantages can be found again (a re-hidden idol); anything else is new
    const held = new Set(Object.values(ctx.game.held).flat().map(a => a.id));
    const pairs = ctx.advantages.filter(a => !held.has(a.id)).map(a => [a.id, a.name]);
    html += fieldHtml('Advantage', selectHtml({ field: '_advantagePick', num: true, rerender: true }, [...pairs, ['__new__', 'New advantage…']],
      card._advantagePick));
    if (card._advantagePick === '__new__') {
      html += fieldHtml('New advantage name', `<input class="entry-input" type="text" data-field="advantage"
        value="${escapeHtml(card.advantage || '')}" placeholder="e.g. Hidden immunity idol (Kele)">`);
    }
    return html;
  }
  if (card.castawayId !== null) {
    const pairs = heldBy(card.castawayId, ctx).map(a => [heldValue(a), a.name]);
    html += fieldHtml('Advantage', selectHtml({ field: 'advantage', num: true }, pairs, card.advantage));
  }
  if (card.action === 'gave') {
    html += fieldHtml('Gave it to', castawaySelect('recipientId', activeIds(ctx).filter(id => id !== card.castawayId),
      card.recipientId, ctx));
  }
  if (card.action === 'played') {
    // Most advantages (an extra vote, an idol kept for yourself) are played by the holder for themselves
    html += fieldHtml('Played on', selectHtml({ field: 'targetId', num: true },
      castawayPairs(activeIds(ctx).filter(id => id !== card.castawayId), ctx), card.targetId, 'Themselves'));
    html += `<label class="entry-check"><input type="checkbox" data-field="changedOutcome"${card.changedOutcome ? ' checked' : ''}>
      Changed who went home</label>`;
  }
  return html;
}

// Exit: a medevac, a quit, or losing at fire-making
function exitHtml(card, ctx) {
  return `<div class="entry-row">
    ${fieldHtml('Reason', selectHtml({ field: 'reason' },
      [['medevac', 'Medevac'], ['quit', 'Quit'], ['fire', 'Lost fire-making']], card.reason, null))}
    ${fieldHtml('Castaway', castawaySelect('castawayId', activeIds(ctx), card.castawayId, ctx))}
  </div>`;
}

// Moment: an iconic moment (with a note saying what happened) or crying on camera
function momentHtml(card, ctx) {
  let html = `<div class="entry-row">
    ${fieldHtml('Moment', selectHtml({ field: 'kind', rerender: true },
      [['iconic', 'Iconic moment'], ['cried', 'Cried on camera']], card.kind, null))}
    ${fieldHtml('Castaway', castawaySelect('castawayId', activeIds(ctx), card.castawayId, ctx))}
  </div>`;
  if (card.kind === 'iconic') {
    html += fieldHtml('Note', `<input class="entry-input" type="text" data-field="note" value="${escapeHtml(card.note || '')}"
      placeholder="What happened">`);
  }
  return html;
}

// Jury votes, juror by juror like Tribal: everyone out of the game, most recent exit first so the jury is on top,
// picks the finalist they voted for (the finalists are whoever is still in the game). Anyone left on "Not on jury"
// didn't vote.
function ftcHtml(card, ctx) {
  const finalists = activeIds(ctx);
  const jurors = [...ctx.game.out].reverse();
  const votes = jurors.map(id => `<div class="entry-pair">
      <span class="entry-pair-name">${escapeHtml(ctx.short.get(id))}</span>
      ${selectHtml({ map: 'votes', key: id, num: true, rerender: true }, castawayPairs(finalists, ctx), card.votes[id], 'Not on jury')}
    </div>`).join('');
  return groupHtml('Jury votes', voteCountHtml(card, jurors, ctx) + votes);
}

// Every column of an events row, for the Custom row card. Any castaway, tribe or advantage in the season can be
// picked, in or out of the game.
function rowFieldsHtml(row, ctx) {
  const types = [...ctx.eventTypes].sort((a, b) => a.name.localeCompare(b.name))
    .map(t => [t.name, `${t.name} (${t.points > 0 ? '+' : ''}${fmt(t.points)})`]);
  return `
    ${fieldHtml('Event type', selectHtml({ field: 'eventType' }, types, row.eventType))}
    <div class="entry-row">
      ${fieldHtml('Castaway', castawaySelect('castawayId', allIds(ctx), row.castawayId, ctx))}
      ${fieldHtml('Other castaway', selectHtml({ field: 'otherCastawayId', num: true }, castawayPairs(allIds(ctx), ctx), row.otherCastawayId, 'None'))}
    </div>
    <div class="entry-row">
      ${fieldHtml('Advantage', selectHtml({ field: 'advantage', num: true }, ctx.advantages.map(a => [a.id, a.name]), row.advantage, 'None'))}
      ${fieldHtml('Tribe', selectHtml({ field: 'tribeId', num: true }, tribePairs(ctx.tribes), row.tribeId, 'None'))}
    </div>
    <div class="entry-row">
      ${fieldHtml('Quantity', `<input class="entry-input entry-count" type="number" inputmode="numeric" data-field="quantity" data-num
        value="${row.quantity ?? ''}">`)}
      ${fieldHtml('Details', `<input class="entry-input" type="text" data-field="details" value="${escapeHtml(row.details || '')}">`)}
    </div>
  `;
}

// ── Card frame ────────────────────────────────────────────────────────────
// Events rows as the function describes them (the rows a card will save, or what an edit adds or removes) under
// `label`, one line each: who, what, the other columns, points
function cardRowsHtml(rows, ctx, label = 'Saves') {
  if (!rows.length) return '';
  const lines = rows.map(r => {
    const advantage = typeof r.advantage === 'number' ? ctx.advantages.find(a => a.id === r.advantage)?.name : r.advantage;
    const details = [
      r.otherCastawayId != null && ctx.short.get(r.otherCastawayId),
      advantage,
      r.tribeId != null && ctx.tribes.find(t => t.id === r.tribeId)?.name,
      r.quantity != null && r.quantity !== 1 && `×${r.quantity}`,
      r.details,
    ].filter(Boolean).join(' · ');
    return `<li><span class="entry-row-main"><strong>${escapeHtml(ctx.short.get(r.castawayId) || '')}</strong>
        ${escapeHtml(r.eventType)}${details ? `<span class="entry-row-details">${escapeHtml(details)}</span>` : ''}</span>
      <span class="entry-row-points${r.points < 0 ? ' neg' : r.points === 0 ? ' zero' : ''}">${r.points > 0 ? '+' : ''}${fmt(r.points)}</span></li>`;
  }).join('');
  return `<div class="entry-card-rows"><span class="entry-label">${escapeHtml(label)}</span><ul>${lines}</ul></div>`;
}

// A card's (or the episode's) errors as a list
function errorListHtml(errors) {
  if (!errors.length) return '';
  return `<ul class="entry-errors">${errors.map(e => `<li>${escapeHtml(e.message)}</li>`).join('')}</ul>`;
}

// One numbered card with move and delete buttons, around its form, then the rows it will save and its errors
function cardHtml(card, index, count, ctx, errors, rows = []) {
  const type = CARD_TYPES[card.type];
  return `<div class="entry-card${errors.length ? ' has-errors' : ''}" data-card="${index}">
    <div class="entry-card-head">
      <span class="entry-card-title">${index + 1}. ${escapeHtml(type.label)}</span>
      <span class="entry-card-actions">
        <button type="button" class="entry-icon-button" data-action="up" aria-label="Move up"${index === 0 ? ' disabled' : ''}>${ICONS.chevronUp}</button>
        <button type="button" class="entry-icon-button" data-action="down" aria-label="Move down"${index === count - 1 ? ' disabled' : ''}>${ICONS.chevronDown}</button>
        <button type="button" class="entry-icon-button" data-action="delete" aria-label="Delete">${ICONS.close}</button>
      </span>
    </div>
    ${type.html(card, ctx)}
    ${cardRowsHtml(rows, ctx)}
    ${errorListHtml(errors)}
  </div>`;
}
