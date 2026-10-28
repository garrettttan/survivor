// Frontend: the episode entry page's card forms.
// Forms only: each renders inputs from a card object and copies inputs back into it. No rules; the
// episode-entry function decides what rows a card makes and whether it's valid.
//
// Card shapes, as sent to the function (ids are castaway, tribe or advantage ids):
//   tribeChange  { kind: 'swap', moves: { [castawayId]: tribeId } } (everyone still in the game must be placed,
//                including anyone who stays on the tribe they were on)
//                { kind: 'move', castawayId, tribeId } (one castaway changes tribe on their own)
//                { kind: 'merge', tribeId } (everyone still in the game joins tribeId)
//   challenge    { prize: 'immunity'|'reward'|'both', format: 'tribe'|'individual'|'teams', first, second,
//                  teamCount, teams: { [castawayId]: teamNumber }, satOut: [id], broughtOnReward: [id] }
//                  (tribe: first/second = tribe ids; individual: first = a castaway id; teams, for teams that aren't
//                  tribes: teamCount teams numbered from 1, teams = who was on each, first/second = team numbers;
//                  anyone still in the game who isn't on a team sat out)
//   tribal       { tribeId, votes: { [voterId]: targetId | 'none' }, outcome: 'voted'|'rocks'|'consensus', bootId }
//   advantage    { action: 'found'|'gave'|'played'|'expired', castawayId, advantage, recipientId, targetId,
//                  changedOutcome } (played: targetId = who it was played on, null when they played it for themselves)
//   exit         { reason: 'medevac'|'quit'|'fire', castawayId }
//   moment       { kind: 'iconic'|'cried', castawayId, note }
//   ftc          { votes: { [jurorId]: finalistId } } (the finalists are everyone still in the game at this card;
//                anyone out who isn't listed wasn't on the jury)
//   custom       { eventType, castawayId, otherCastawayId, advantage, tribeId, quantity, details }
// Every card also carries `type`. Keys starting with "_" are form-only and dropped by cardPayload().
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
    // sat out
    tidy: (card, ctx) => {
      if (card.format !== 'teams') return;
      card.teams = Object.fromEntries(Object.entries(card.teams).filter(([, n]) => n <= card.teamCount));
      if (card.first > card.teamCount) card.first = null;
      if (card.second > card.teamCount || card.teamCount < 3) card.second = null;
      card.satOut = unsortedIds(card, ctx);
    },
  },
  tribal: {
    label: 'Tribal Council',
    // With one tribe in play (after the merge), it's the one at Tribal
    blank: ctx => {
      const tribes = tribesInPlay(ctx);
      return { tribeId: tribes.length === 1 ? tribes[0].id : null, votes: {}, outcome: 'voted', bootId: null, _votesFor: null };
    },
    html: tribalHtml,
    reset: { tribeId: { votes: {}, bootId: null, _votesFor: null } },
    // Rocks takes no votes, so they're cleared (and filled in again if the outcome changes back)
    tidy: (card, ctx) => {
      if (card.outcome === 'rocks') Object.assign(card, { votes: {}, _votesFor: null });
      else if (card.tribeId !== null) prefillVotes(card, membersOf(card.tribeId, ctx));
    },
  },
  advantage: {
    label: 'Advantage',
    blank: () => ({ action: 'found', castawayId: null, advantage: null, recipientId: null, targetId: null, changedOutcome: false, _advantagePick: null }),
    html: advantageHtml,
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
function byShortName(ids, ctx) {
  return [...ids].sort((a, b) => (ctx.short.get(a) || '').localeCompare(ctx.short.get(b) || ''));
}

// Castaways still in the game
function activeIds(ctx) {
  const out = new Set(ctx.game.out);
  return byShortName(ctx.castaways.map(c => c.id).filter(id => !out.has(id)), ctx);
}

function allIds(ctx) {
  return byShortName(ctx.castaways.map(c => c.id), ctx);
}

function membersOf(tribeId, ctx) {
  return activeIds(ctx).filter(id => ctx.game.tribeOf[id] === tribeId);
}

// Tribes with anyone still in the game on them
function tribesInPlay(ctx) {
  return ctx.tribes.filter(t => membersOf(t.id, ctx).length);
}

function heldBy(castawayId, ctx) {
  return ctx.game.held[castawayId] || [];
}

// A held advantage's value in a picker: its id, or its name while it's still new
function heldValue(adv) {
  return adv.id ?? adv.name;
}

// ── Inputs ────────────────────────────────────────────────────────────────
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

function selectHtml(bind, pairs, selected, blank = 'Choose…') {
  return `<select class="entry-input"${attrs(bind)}>${optionsHtml(pairs, selected, blank)}</select>`;
}

function castawayPairs(ids, ctx) {
  return ids.map(id => [id, ctx.short.get(id)]);
}

function castawaySelect(field, ids, selected, ctx, extra = {}) {
  return selectHtml({ field, num: true, ...extra }, castawayPairs(ids, ctx), selected);
}

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
function tribeChangeHtml(card, ctx) {
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
// → group id; groups are [{ id, name, color }]; `ids` are the castaways to sort (default: everyone still in).
function sortIntoGroupsHtml(assign, groups, card, ctx, ids = activeIds(ctx)) {
  const blocks = groups.map(g => {
    const placed = ids.filter(id => card[assign][id] === g.id);
    const chips = ids.map(id => {
      const here = card[assign][id] === g.id;
      const elsewhere = !here && card[assign][id] != null;
      return `<label class="entry-chip entry-swap-chip${elsewhere ? ' elsewhere' : ''}">
        <input type="checkbox" value="${g.id}" data-assign="${assign}" data-key="${id}" data-num data-rerender${here ? ' checked' : ''}>
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
  // Only an individual reward winner brings people along; a tribe or team reward goes to the whole group
  if (card.prize !== 'immunity' && individual) {
    const others = activeIds(ctx).filter(id => id !== card.first);
    html += groupHtml('Brought on reward', checkChipsHtml('broughtOnReward', others, card.broughtOnReward, ctx));
  }
  return html;
}

// Most votes go to whoever went home, so picking them fills in everyone else's vote. Picking someone else later
// moves the votes that were filled in (or still pointed at the old pick); votes you changed stay. `_votesFor`
// remembers who the votes were filled for.
function prefillVotes(card, attendees) {
  if (card.bootId === null || card._votesFor === card.bootId) return;
  const votes = { ...card.votes };
  for (const id of attendees) {
    if (id === card.bootId) {
      if (votes[id] === card._votesFor || votes[id] === card.bootId) delete votes[id];
    } else if (votes[id] === undefined || votes[id] === card._votesFor) {
      votes[id] = card.bootId;
    }
  }
  card.votes = votes;
  card._votesFor = card.bootId;
}

function tribalHtml(card, ctx) {
  let html = groupHtml('Tribe', tribeChoicesHtml({ field: 'tribeId', num: true, rerender: true }, tribesInPlay(ctx), card.tribeId)) +
    fieldHtml('Outcome', selectHtml({ field: 'outcome', rerender: true },
      [['voted', 'Voted out'], ['rocks', 'Went home on rocks'], ['consensus', 'Deadlock consensus']], card.outcome, null));
  if (card.tribeId === null) return html + '<p class="entry-hint">Pick the tribe to choose who went home and enter the votes.</p>';
  const attendees = membersOf(card.tribeId, ctx);
  html += fieldHtml('Went home', castawaySelect('bootId', attendees, card.bootId, ctx, { rerender: true }));
  if (card.outcome === 'rocks') return html;
  const votes = attendees.map(id => `<div class="entry-pair">
      <span class="entry-pair-name">${escapeHtml(ctx.short.get(id))}</span>
      ${selectHtml({ map: 'votes', key: id, num: true, rerender: true },
        [...castawayPairs(attendees.filter(t => t !== id), ctx), ['none', 'No vote']], card.votes[id])}
    </div>`).join('');
  return html + groupHtml('Final-round votes', voteCountHtml(card, attendees, ctx) + votes);
}

// How many votes each castaway is getting, most first; anyone without votes is left out
function voteCountHtml(card, attendees, ctx) {
  const counts = new Map();
  attendees.forEach(id => {
    const target = card.votes[id];
    if (typeof target === 'number') counts.set(target, (counts.get(target) || 0) + 1);
  });
  if (!counts.size) return '';
  const tally = [...counts].sort((a, b) => b[1] - a[1] || ctx.short.get(a[0]).localeCompare(ctx.short.get(b[0])))
    .map(([id, n]) => `<span class="entry-vote-count">${escapeHtml(ctx.short.get(id))} <strong>${n}</strong></span>`).join('');
  return `<div class="entry-chips entry-vote-counts">${tally}</div>`;
}

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

function exitHtml(card, ctx) {
  return `<div class="entry-row">
    ${fieldHtml('Reason', selectHtml({ field: 'reason' },
      [['medevac', 'Medevac'], ['quit', 'Quit'], ['fire', 'Lost fire-making']], card.reason, null))}
    ${fieldHtml('Castaway', castawaySelect('castawayId', activeIds(ctx), card.castawayId, ctx))}
  </div>`;
}

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
// The events rows a card will save (from the latest preview), one line each: who, what, the other columns, points
function cardRowsHtml(rows, ctx) {
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
  return `<div class="entry-card-rows"><span class="entry-label">Saves</span><ul>${lines}</ul></div>`;
}

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
