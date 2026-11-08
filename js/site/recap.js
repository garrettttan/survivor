// Site: the episode recap — one episode at a time: who went home and any swap or merge, how each team scored, then
// what happened, by section, in the order it happened. What happened comes from the get-episode-recap edge function
// (js/api/load.js fetchEpisodeRecap), one item per card the episode was entered from; this file only draws them.

let recapEpisode = null;            // the episode shown; null = the latest
const recapCache = new Map();       // episode → its recap (or the promise of it), for this season

// The sections, in the order they're shown. An item that isn't a headline goes in one of them.
const RECAP_SECTIONS = ['Tribes', 'Challenges', 'Tribal council', 'Advantages', 'Moments', 'Final tribal council', 'Other'];
// A row no card describes goes in the section for its event type's category
const RECAP_CATEGORY_SECTIONS = {
  Tribes: 'Tribes', Challenges: 'Challenges', Voting: 'Tribal council', 'Idols and advantages': 'Advantages',
  Moments: 'Moments',
};

// ── Small pieces ─────────────────────────────────────────────────────────────

// Looks up castaways (from the draft data) and tribes (from the recap) by id, and draws them
function recapContext(data, recap) {
  const byId = new Map(data.castaways.map(c => [c.id, c]));
  const short = shortNames(data.castaways);
  const tribes = new Map(recap.tribes.map(t => [t.id, t]));
  const name = id => {
    const c = byId.get(id);
    if (!c) return '<span class="muted">someone</span>';
    return `<button type="button" class="recap-name" data-castaway="${escapeHtml(c.name)}">${escapeHtml(short.get(c.name) || c.name)}</button>`;
  };
  return {
    name,                                         // a castaway's short name, tappable to open their panel
    names: ids => ids.map(name).join(', '),
    tribe: id => {
      const t = tribes.get(id);
      return t ? tribeBadge({ tribeName: t.name, tribeColor: t.color }) : '';
    },
  };
}

// A labelled row. Entries with more than a name (an advantage, a note) get a line each; plain names share lines.
function recapRow(label, entries, stacked) {
  return `<div class="recap-row"><div class="recap-label">${label}</div>
    <div class="recap-whos${stacked ? ' recap-whos-stacked' : ''}">${entries.map(e => `<span class="recap-who">${e}</span>`).join('')}</div></div>`;
}

// "Key value" lines under a row's label (a challenge's winners, who sat out, ...); empty values are left out
function recapLines(lines) {
  return lines.filter(([, value]) => value).map(([key, value]) =>
    `<div class="recap-line"><span class="recap-key">${key}</span> ${value}</div>`).join('');
}

// Votes counted by who they were for, most first: "Brady 9 — Cristian, Kilby, ..." (`pairs`: [target, voter])
function recapTally(pairs, ctx) {
  const byTarget = new Map();
  pairs.forEach(([target, voter]) => {
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push(voter);
  });
  return [...byTarget].sort((a, b) => b[1].length - a[1].length).map(([target, voters]) => `<div class="recap-vote">
      ${ctx.name(target)} <span class="recap-count">${voters.length}</span>
      <span class="muted">— ${ctx.names(voters)}</span>
    </div>`).join('');
}

// ── Items ────────────────────────────────────────────────────────────────────

const RECAP_PRIZES = { reward: 'Reward challenge', immunity: 'Immunity challenge', both: 'Reward and immunity challenge' };
const RECAP_EXITS = { medevac: 'was medically evacuated', quit: 'quit', fire: 'lost fire-making' };
const RECAP_BOOTS = { voted: 'voted out', rocks: 'went home on a rock draw', consensus: 'voted out by consensus' };
const RECAP_SAFE = { immunity: 'immunity', idol: 'idol', shot: 'Shot in the Dark' };

function challengeSideHtml(side, ctx) {
  if (!side) return '';
  return side.tribeId != null ? ctx.tribe(side.tribeId) : ctx.names(side.castawayIds);
}

function challengeHtml(item, ctx) {
  return `<div class="recap-row"><div class="recap-label">${RECAP_PRIZES[item.prize] || 'Challenge'}</div>
    ${recapLines([
      ['Won', challengeSideHtml(item.first, ctx)],
      ['2nd', challengeSideHtml(item.second, ctx)],
      ['Sat out', ctx.names(item.satOut)],
      ['Brought along', ctx.names(item.broughtOnReward)],
    ])}</div>`;
}

function tribalHtml(item, ctx) {
  const votes = item.votes.filter(v => !v.shot && v.targetId != null).map(v => [v.targetId, v.voterId]);
  const shots = item.votes.filter(v => v.shot).map(v => v.voterId);
  const safe = item.safe.map(s => `${ctx.name(s.castawayId)} <span class="muted">(${RECAP_SAFE[s.reason]})</span>`).join(', ');
  const note = { rocks: 'Went to rocks', consensus: 'Decided by consensus' }[item.outcome];
  return `<div class="recap-row"><div class="recap-label">${item.tribeId != null ? ctx.tribe(item.tribeId) : 'Votes'}</div>
    ${recapTally(votes, ctx)}
    ${recapLines([['Shot in the Dark', ctx.names(shots)], ['Safe', safe]])}
    ${note ? `<div class="recap-line muted">${note}</div>` : ''}</div>`;
}

// What a grouped row is labelled, this item's entry in it, and whether the entry is more than a name
function groupedEntry(item, ctx) {
  const badge = item.advantage ? advantageBadge(item.advantage) : '';
  switch (item.type) {
    case 'advantage': {
      if (item.action === 'gave') {
        return ['Gave away advantage', `${badge} ${ctx.name(item.castawayId)} <span class="muted">→</span> ${ctx.name(item.recipientId)}`];
      }
      if (item.action === 'played') {
        const on = item.targetId != null && item.targetId !== item.castawayId ? ` <span class="muted">on</span> ${ctx.name(item.targetId)}` : '';
        const wasted = item.changedOutcome ? '' : ' <span class="muted">(didn’t change the outcome)</span>';
        return ['Played advantage', `${ctx.name(item.castawayId)} ${badge}${on}${wasted}`];
      }
      return [item.action === 'expired' ? 'Advantage expired' : 'Found advantage', `${ctx.name(item.castawayId)} ${badge}`];
    }
    case 'moment':
      return [item.kind === 'cried' ? 'Cried on camera' : 'Had an iconic moment',
        `${ctx.name(item.castawayId)}${item.note ? ` <span class="muted">(${escapeHtml(item.note)})</span>` : ''}`, !!item.note];
    case 'tribes':   // one castaway switching tribes
      return ['Switched tribes', item.moves.map(m => `${ctx.name(m.castawayId)} <span class="muted">→</span> ${ctx.tribe(m.tribeId)}`).join(', ')];
    case 'event': {
      const extra = [
        badge,
        item.otherCastawayId != null ? `<span class="muted">→</span> ${ctx.name(item.otherCastawayId)}` : '',
        item.tribeId != null ? ctx.tribe(item.tribeId) : '',
        item.details ? `<span class="muted">(${escapeHtml(item.details)})</span>` : '',
      ].filter(Boolean).join(' ');
      return [escapeHtml(item.event), `${ctx.name(item.castawayId)}${extra ? ' ' + extra : ''}`, !!extra];
    }
  }
  return null;
}

// The section an item goes in, or 'headline' for who went home, a swap or merge, and the winner
function recapSection(item) {
  switch (item.type) {
    case 'tribes': return item.kind === 'move' ? 'Tribes' : 'headline';
    case 'exit': return 'headline';
    case 'challenge': return 'Challenges';
    case 'tribal': return 'Tribal council';
    case 'advantage': return 'Advantages';
    case 'moment': return 'Moments';
    case 'ftc': return 'Final tribal council';
    case 'event': return item.category === 'Eliminations' ? 'headline' : RECAP_CATEGORY_SECTIONS[item.category] || 'Other';
  }
  return 'Other';
}

// The headline lines an item adds: who went home and how, a swap, the merge, the winner
function headlineLines(item, ctx) {
  const tribesOf = moves => [...new Set(moves.map(m => m.tribeId).filter(id => id != null))].map(ctx.tribe).join(' ');
  switch (item.type) {
    case 'tribes':
      if (item.kind === 'merge') return [`🔀 Merged into <span class="recap-badges">${ctx.tribe(item.tribeId)}</span>`];
      if (item.kind === 'swap') return [`🔀 Swapped tribes <span class="recap-badges">${tribesOf(item.moves)}</span>`];
      if (item.kind === 'start') return [`🏝️ Starting tribes <span class="recap-badges">${tribesOf(item.moves)}</span>`];
      return [];
    case 'exit': return [`☠️ ${ctx.name(item.castawayId)} <span class="muted">${RECAP_EXITS[item.reason] || 'left the game'}</span>`];
    case 'tribal':
      return item.bootId != null ? [`☠️ ${ctx.name(item.bootId)} <span class="muted">${RECAP_BOOTS[item.outcome] || 'voted out'}</span>`] : [];
    case 'ftc': return item.winnerId != null ? [`🏆 ${ctx.name(item.winnerId)} won`] : [];
    case 'event':
      return item.category === 'Eliminations'
        ? [`☠️ ${ctx.name(item.castawayId)} <span class="muted">${escapeHtml(item.event.toLowerCase())}</span>`] : [];
  }
  return [];
}

// Under Other (e.g. older seasons' lump "Episode points"): each castaway once per event, with the points it gave them
function otherHtml(items, ctx) {
  const byEvent = new Map();
  items.forEach(item => {
    if (!byEvent.has(item.event)) byEvent.set(item.event, new Map());
    const points = byEvent.get(item.event);
    points.set(item.castawayId, (points.get(item.castawayId) || 0) + item.points);
  });
  const rows = [...byEvent].map(([event, points]) => recapRow(escapeHtml(event),
    [...points].sort((a, b) => b[1] - a[1]).map(([id, pts]) =>
      `${ctx.name(id)}${pts ? ` <span class="muted">${pts > 0 ? '+' : ''}${fmt(pts)}</span>` : ''}`), false)).join('');
  return rows ? `<div class="recap-group"><div class="sheet-section-header">Other</div>${rows}</div>` : '';
}

// One section's items, in order. Challenges, Tribals and final Tribals are a row each; everything else is grouped
// by its label, where that label first comes up, an entry per line.
function sectionHtml(title, items, ctx) {
  if (title === 'Other') return otherHtml(items.filter(i => i.type === 'event'), ctx);
  const parts = [];
  const groups = new Map();
  items.forEach(item => {
    if (item.type === 'challenge') return parts.push(challengeHtml(item, ctx));
    if (item.type === 'tribal') return parts.push(tribalHtml(item, ctx));
    if (item.type === 'ftc') {
      if (!item.votes.length) return;   // the winner is in the headline; their votes weren't recorded
      return parts.push(`<div class="recap-row"><div class="recap-label">Jury votes</div>${recapTally(item.votes.map(v => [v.finalistId, v.jurorId]), ctx)}</div>`);
    }
    const entry = groupedEntry(item, ctx);
    if (!entry) return;
    const [label, html, detailed = true] = entry;
    if (!groups.has(label)) {
      groups.set(label, { entries: [], stacked: false });
      parts.push(() => recapRow(label, groups.get(label).entries, groups.get(label).stacked));
    }
    groups.get(label).entries.push(html);
    if (detailed) groups.get(label).stacked = true;
  });
  if (!parts.length) return '';
  return `<div class="recap-group"><div class="sheet-section-header">${title}</div>
    ${parts.map(p => typeof p === 'function' ? p() : p).join('')}</div>`;
}

// Each team's points this episode, as bars, highest first
function recapTeamsHtml({ teams, teamNames }, episode) {
  const scores = teamNames.map(t => ({ t, score: teams[t].scoreByEpisode[episode - 1] || 0 }))
    .sort((a, b) => b.score - a.score);
  const max = Math.max(...scores.map(s => s.score), 1);
  return `<div class="recap-group">
      <div class="sheet-section-header">Team points</div>
      ${scores.map(({ t, score }) => `<div class="recap-team">
        <span class="recap-team-name" style="color:${teams[t].color}">${escapeHtml(t)}</span>
        <span class="recap-bar"><span style="width:${Math.max(score, 0) / max * 100}%;background:${teams[t].color}"></span></span>
        <span class="recap-team-pts">${score > 0 ? '+' : ''}${fmt(score)}</span>
      </div>`).join('')}
    </div>`;
}

// ── Drawing ──────────────────────────────────────────────────────────────────

function recapBodyHtml(data, recap, episode) {
  const ctx = recapContext(data, recap);
  const headline = recap.items.flatMap(item => headlineLines(item, ctx));
  const bySection = new Map(RECAP_SECTIONS.map(s => [s, []]));
  recap.items.forEach(item => {
    const section = recapSection(item);
    if (section !== 'headline') bySection.get(section).push(item);
  });
  return `
    <div class="recap-title">Episode ${episode}</div>
    ${headline.length ? `<div class="recap-headline">${headline.map(l => `<div>${l}</div>`).join('')}</div>` : ''}
    ${recapTeamsHtml(data, episode)}
    ${RECAP_SECTIONS.map(s => sectionHtml(s, bySection.get(s), ctx)).join('')}
  `;
}

// The episode's recap, fetched once per episode (a failed fetch is tried again next time)
function loadRecap(episode) {
  if (!recapCache.has(episode)) {
    recapCache.set(episode, fetchEpisodeRecap(currentEntry.season, episode).catch(err => {
      recapCache.delete(episode);
      throw err;
    }));
  }
  return recapCache.get(episode);
}

// The episode picker, then the chosen episode's recap once it's loaded
async function renderRecap(data) {
  const { episodeCount } = data;
  if (!episodeCount) {
    document.getElementById('recap').hidden = true;
    return;
  }
  const episode = recapEpisode ?? episodeCount;
  const picker = document.getElementById('recap-picker');
  picker.innerHTML = Array.from({ length: episodeCount }, (_, i) =>
    `<button type="button" class="recap-ep" data-episode="${i + 1}" aria-pressed="${i + 1 === episode}">${i + 1}</button>`).join('');
  // Keep the chosen episode in view in the picker (without moving the page)
  const btn = picker.querySelector('[aria-pressed="true"]');
  picker.scrollLeft = btn.offsetLeft - (picker.clientWidth - btn.offsetWidth) / 2;

  const body = document.getElementById('recap-body');
  const stillChosen = () => episode === (recapEpisode ?? episodeCount);
  body.innerHTML = `<div class="recap-title">Episode ${episode}</div><p class="muted recap-note">Loading…</p>`;
  try {
    const recap = await loadRecap(episode);
    if (stillChosen()) body.innerHTML = recapBodyHtml(data, recap, episode);
  } catch (err) {
    if (stillChosen()) {
      body.innerHTML = `<div class="recap-title">Episode ${episode}</div>
        <p class="muted recap-note">Couldn’t load this episode. ${escapeHtml(err.message)}</p>`;
    }
  }
}

document.getElementById('recap-picker').addEventListener('click', e => {
  const btn = e.target.closest('[data-episode]');
  if (!btn) return;
  recapEpisode = Number(btn.dataset.episode);
  renderRecap(appData);
});
