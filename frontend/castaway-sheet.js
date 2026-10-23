// Frontend: the castaway detail panel (bottom sheet on phones, modal on desktop).

function openSheet(name) {
  const c = appData.castaways.find(x => x.name === name);
  if (!c) return;

  const ownerColor = appData.teamColor[c.teams[0]] || FALLBACK_COLOR;
  const statusBadge = c.active
    ? '<span class="active-badge">Active</span>'
    : '<span class="eliminated-label">☠️ Eliminated</span>';

  const advHtml = [
    ...c.advantages.map(a => `<span class="badge badge-adv">${escapeHtml(a)}</span>`),
    ...c.expiredAdvantages.map(a => `<span class="badge badge-adv adv-used">${escapeHtml(a)}</span>`),
  ].join(' ');

  document.getElementById('sheet-body').innerHTML = `
    <div class="sheet-top">
      <div class="sheet-hero-name">${escapeHtml(c.name)}</div>
      <span class="sheet-pts" style="color:${ownerColor}">${fmt(c.points)} pts</span>
    </div>
    <div class="sheet-meta">
      ${statusBadge} ${advHtml}
      ${c.teams.length ? `<span class="sheet-owner">Drafted by ${c.teams.map(teamNameHtml).join(', ')}</span>` : ''}
    </div>
    ${timelineHtml(c)}
  `;

  document.getElementById('sheet-overlay').classList.add('open');
  document.getElementById('bottom-sheet').classList.add('open');
  document.body.style.overflow = 'hidden';
}

// Everyone else who was on the tribe during this stint (listed by the server)
function sortTribemates(members) {
  const cmp = (x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' });
  const splitName = n => {
    const [first, ...rest] = n.split(' ');
    return [first, rest.join(' ')];
  };
  // Active first, then by first name, then last name
  return [...members].sort((a, b) => {
    const [aFirst, aLast] = splitName(a.name);
    const [bFirst, bLast] = splitName(b.name);
    return b.active - a.active || cmp(aFirst, bFirst) || cmp(aLast, bLast);
  });
}

// A stint's tribemates as name chips (short names; out players dashed and struck through) in a panel tinted
// with the tribe's color (the band's --tribe-tint). A chip opens that castaway's sheet.
function tribematesHtml(stint, short) {
  const mates = sortTribemates(stint.members);
  const chips = mates.length
    ? `<div class="tribemate-chips">${mates.map(m => `<button type="button" class="tribemate-chip${m.active ? '' : ' out'}" data-castaway="${escapeHtml(m.name)}">${escapeHtml(short.get(m.name) || m.name)}</button>`).join('')}</div>`
    : '<div class="empty-note">No tribemates found</div>';
  return `<div class="band-members">
      <div class="band-members-label">Tribemates</div>
      ${chips}
    </div>`;
}

// Details in parentheses, the idol/advantage as a badge (its name can have its own parentheses,
// e.g. "Extra vote (Savu)"), then the other castaway (tap to open their sheet). The tribe is left out:
// the band the row sits in already shows it.
function eventDetailHtml(e) {
  const other = e.otherCastaway;
  return (e.details ? ` <span class="muted">(${escapeHtml(e.details)})</span>` : '') +
    (e.advantage ? ` <span class="badge badge-adv">${escapeHtml(e.advantage)}</span>` : '') +
    (other ? ` <span class="muted">— <span class="clickable" data-castaway="${escapeHtml(other.name)}">${escapeHtml(other.name)}</span></span>` : '');
}

// The log split into one band per tribe stint, in order. A stint's tribe-change row ("Swapped tribes" to that
// tribe) starts its band and isn't listed, since the band header shows it. A stint without one starts once the
// log moves past its start episode. Rows before the first stint go in a leading band with no stint.
function timelineBands(c) {
  const bands = [{ stint: null, rows: [] }];
  let next = 0; // the next stint to start
  [...c.log].sort((a, b) => a.episode - b.episode).forEach(e => {
    let isChange = false;
    while (next < c.tribes.length) {
      const s = c.tribes[next];
      isChange = e.tribe === s.tribeName && e.name.toLowerCase() === (s.startReason || '').toLowerCase();
      if (!isChange && e.episode <= s.startEpisode) break;
      bands.push({ stint: s, rows: [] });
      next++;
      if (isChange) break;
    }
    if (!isChange) bands[bands.length - 1].rows.push(e);
  });
  // Stints with no log rows after them still get a band, for the header and members
  c.tribes.slice(next).forEach(s => bands.push({ stint: s, rows: [] }));
  return bands.filter(b => b.stint || b.rows.length);
}

// Log rows grouped under an episode label, a line between episodes
function episodesHtml(rows) {
  const byEpisode = new Map();
  rows.forEach(e => {
    if (!byEpisode.has(e.episode)) byEpisode.set(e.episode, []);
    byEpisode.get(e.episode).push(e);
  });
  return [...byEpisode.entries()].map(([episode, events]) => `
    <div class="sheet-episode">
      <div class="episode-label">EPISODE ${episode}</div>
      ${events.map(e => `<div class="sheet-row">
        <span class="sheet-row-name">${escapeHtml(e.name)}${eventDetailHtml(e)}</span>
        ${e.points ? `<span class="event-pts">${e.points > 0 ? '+' : ''}${fmt(e.points)}</span>` : ''}
      </div>`).join('')}
    </div>`).join('');
}

// Every log row, in bands accented in each stint's tribe color. A band's header (the tribe badge, and
// "N tribemates" and the round expand button on the right) opens to list the tribemates for that stint; all start closed.
function timelineHtml(c) {
  const bands = timelineBands(c);
  if (!bands.length) return '';
  const short = shortNames(appData.castaways);
  const bandHtml = band => {
    const episodes = band.rows.length ? `<div class="band-episodes">${episodesHtml(band.rows)}</div>` : '';
    const s = band.stint;
    if (!s) return `<div class="tribe-band">${episodes}</div>`;
    const color = tribeColor(s);
    return `<div class="tribe-band" style="border-left-color:${color};--tribe:${color};--tribe-contrast:${contrastText(color)};--tribe-tint:${hexToRgba(color, 0.14)};--tribe-tint-border:${hexToRgba(color, 0.4)}">
      <button type="button" class="sheet-section-header band-header" aria-expanded="false">
        ${tribeBadge(s)}
        <span class="band-hint">${s.members.length} ${s.members.length === 1 ? 'tribemate' : 'tribemates'}<span class="expand-btn expand-btn-sm">${ICONS.chevronDown}</span></span>
      </button>
      <div class="collapse-wrap"><div class="collapse-inner">${tribematesHtml(s, short)}</div></div>
      ${episodes}
    </div>`;
  };
  return `<div class="sheet-group">
      <div class="sheet-section-header">Timeline</div>
      <div class="sheet-timeline">${bands.map(bandHtml).join('')}</div>
    </div>`;
}

// Toggle a timeline band to show its tribemates
document.getElementById('sheet-body').addEventListener('click', e => {
  const btn = e.target.closest('.band-header');
  if (!btn) return;
  const open = btn.parentElement.classList.toggle('open');
  btn.setAttribute('aria-expanded', open);
});

function closeSheet() {
  const sheet = document.getElementById('bottom-sheet');
  sheet.classList.remove('dragging');
  sheet.style.transform = '';
  document.getElementById('sheet-overlay').classList.remove('open');
  sheet.classList.remove('open');
  document.body.style.overflow = '';
}

// Drag-to-dismiss
{
  const handle = document.getElementById('sheet-handle');
  const sheet = document.getElementById('bottom-sheet');
  let startY = 0, currentY = 0, dragging = false;

  function onStart(y) {
    if (isDesktop()) return;
    dragging = true;
    startY = y;
    currentY = 0;
    sheet.classList.add('dragging');
  }
  function onMove(y) {
    if (!dragging) return;
    currentY = Math.max(0, y - startY);
    sheet.style.transform = `translateY(${currentY}px)`;
  }
  function onEnd() {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    if (currentY > 100) {
      closeSheet();
    } else {
      sheet.style.transform = '';
    }
  }

  handle.addEventListener('mousedown', e => { onStart(e.clientY); e.preventDefault(); });
  document.addEventListener('mousemove', e => onMove(e.clientY));
  document.addEventListener('mouseup', onEnd);

  handle.addEventListener('touchstart', e => onStart(e.touches[0].clientY), { passive: true });
  document.addEventListener('touchmove', e => onMove(e.touches[0].clientY), { passive: true });
  document.addEventListener('touchend', onEnd);
}

document.getElementById('sheet-overlay').addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

// Open the detail sheet for any element (or row) tagged with data-castaway
document.addEventListener('click', e => {
  const el = e.target.closest('[data-castaway]');
  if (el) openSheet(el.dataset.castaway);
});
