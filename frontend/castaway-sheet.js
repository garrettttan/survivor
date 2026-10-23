// Frontend: the castaway detail panel (bottom sheet on phones, modal on desktop).

function openSheet(name) {
  const c = appData.castaways.find(x => x.name === name);
  if (!c) return;

  const ownerColor = appData.teamColor[c.teams[0]] || FALLBACK_COLOR;
  const statusBadge = c.eliminated
    ? '<span class="eliminated-label">☠️ Eliminated</span>'
    : '<span class="active-badge">Active</span>';

  const advHtml = [
    ...c.advantages.map(a => `<span class="badge badge-adv">${escapeHtml(a)}</span>`),
    ...c.usedAdvantages.map(a => `<span class="badge badge-adv adv-used">${escapeHtml(a)}</span>`),
  ].join(' ');

  // Only the latest phase starts expanded
  const tribesHtml = c.tribes.map((t, i) => `<details class="sheet-section tribe-phase" style="border-left-color:${getTribeColor(t.name).color}"${i === c.tribes.length - 1 ? ' open' : ''}>
      <summary class="sheet-section-header">${tribeBadge(t.name)} (${escapeHtml(tribeLabel(t))})</summary>
      ${tribemateRows(sortTribemates(t.members))}
    </details>`).join('');

  document.getElementById('sheet-body').innerHTML = `
    <div class="sheet-top">
      <div class="sheet-hero-name">${escapeHtml(c.name)}</div>
      <span class="sheet-pts" style="color:${ownerColor}">${fmt(c.total)} pts</span>
    </div>
    <div class="sheet-meta">
      ${statusBadge} ${advHtml}
      ${c.teams.length ? `<span class="sheet-owner">Drafted by ${c.teams.map(teamNameHtml).join(', ')}</span>` : ''}
    </div>
    ${eventLogHtml(c)}
    <div class="sheet-tribes">
      <div class="sheet-section-header">Past Tribes</div>
      ${tribesHtml}
    </div>
  `;

  document.getElementById('sheet-overlay').classList.add('open');
  document.getElementById('bottom-sheet').classList.add('open');
  document.body.style.overflow = 'hidden';
}

// "Starting tribe", or the reason plus the episode the stint began ("Swapped tribes ep. 4")
function tribeLabel(t) {
  if (t.reason.toLowerCase() === 'starting tribe') return t.reason;
  return [t.reason, `ep. ${t.startEpisode}`].filter(Boolean).join(' ');
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
    return a.eliminated - b.eliminated || cmp(aFirst, bFirst) || cmp(aLast, bLast);
  });
}

function tribemateRows(mates) {
  if (!mates.length) return '<div class="empty-note">No tribemates found</div>';
  return mates.map(m => `<div class="sheet-row ${m.eliminated ? 'out' : ''}">
      <span class="sheet-row-name clickable" data-castaway="${escapeHtml(m.name)}">${escapeHtml(m.name)}</span>
    </div>`).join('');
}

// Scoring breakdown by episode (tribe changes are already left out of c.events)
function eventLogHtml(c) {
  if (!c.events.length) return '';

  const byEpisode = new Map();
  c.events.forEach(e => {
    if (!byEpisode.has(e.episode)) byEpisode.set(e.episode, []);
    byEpisode.get(e.episode).push(e);
  });
  const episodeEntries = [...byEpisode.entries()].sort((a, b) => a[0] - b[0]);
  return `<div class="sheet-scoring">
      <div class="sheet-section-header">Scoring Breakdown</div>
      ${episodeEntries.map(([episode, events]) => `
        <div class="sheet-episode">
          <div class="episode-label">EPISODE ${episode}</div>
          ${events.map(e => `<div class="sheet-row">
            <span class="sheet-row-name">${escapeHtml(e.event)}${e.details ? ` <span class="muted">(${escapeHtml(e.details)})</span>` : ''}${e.other ? ` <span class="muted">— <span class="clickable" data-castaway="${escapeHtml(e.other.name)}">${escapeHtml(e.other.name)}</span></span>` : ''}</span>
            <span class="event-pts">${e.points > 0 ? '+' : ''}${fmt(e.points)}</span>
          </div>`).join('')}
        </div>
      `).join('')}
    </div>`;
}

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
