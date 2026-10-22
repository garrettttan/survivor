// Frontend: the castaway detail panel (bottom sheet on phones, modal on desktop).

function openSheet(name) {
  const c = appData.castaways.find(x => x.name === name);
  if (!c) return;

  const draftedBy = [...new Set(appData.castaways.filter(x => x.name === name).map(x => x.team))];
  const ownerColor = appData.teamColor[c.team] || FALLBACK_COLOR;
  const statusBadge = c.eliminated
    ? '<span class="eliminated-label">☠️ Eliminated</span>'
    : '<span class="active-badge">Active</span>';

  const advHtml = [
    ...c.advantages.map(a => `<span class="badge badge-adv">${escapeHtml(a)}</span>`),
    ...c.usedAdvantages.map(a => `<span class="badge badge-adv adv-used">${escapeHtml(a)}</span>`),
  ].join(' ');

  // Only the latest phase starts expanded
  const tribesHtml = c.tribes.map((t, i) => `<details class="sheet-section tribe-phase" style="border-left-color:${getTribeColor(t.value).color}"${i === c.tribes.length - 1 ? ' open' : ''}>
      <summary class="sheet-section-header">${escapeHtml(t.field)} ${tribeBadge(t.value)}</summary>
      ${tribemateRows(tribemates(name, t.value, t.week))}
    </details>`).join('');

  document.getElementById('sheet-body').innerHTML = `
    <div class="sheet-top">
      <div class="sheet-hero-name">${escapeHtml(c.name)}</div>
      <span class="sheet-pts" style="color:${ownerColor}">${fmt(c.total)} pts</span>
    </div>
    <div class="sheet-meta">
      ${statusBadge} ${advHtml}
      <span class="sheet-owner">Drafted by ${draftedBy.map(teamNameHtml).join(', ')}</span>
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

// Tribe x was on as of week w (their latest tribe entry at or before w)
function tribeAsOf(x, w) {
  const entry = x.tribes.filter(t => t.week <= w).pop();
  return entry ? entry.value : '';
}

// Everyone else on the tribe at that week who was still in the game
function tribemates(name, tribeName, week) {
  const all = appData.castaways.filter(x => x.name !== name &&
    tribeAsOf(x, week) === tribeName && (!x.eliminated || x.eliminatedWeek >= week));
  const byName = new Map();
  all.forEach(m => { if (!byName.has(m.name)) byName.set(m.name, m); });
  const cmp = (x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' });
  const splitName = n => {
    const [first, ...rest] = n.split(' ');
    return [first, rest.join(' ')];
  };
  // Active first, then by first name, then last name
  return [...byName.values()].sort((a, b) => {
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

// Scoring breakdown by week (tribe changes are already left out of c.events)
function eventLogHtml(c) {
  if (!c.events.length) return '';

  const byWeek = new Map();
  c.events.forEach(e => {
    if (!byWeek.has(e.week)) byWeek.set(e.week, []);
    byWeek.get(e.week).push(e);
  });
  const weekEntries = [...byWeek.entries()].sort((a, b) => a[0] - b[0]);
  return `<div class="sheet-scoring">
      <div class="sheet-section-header">Scoring Breakdown</div>
      ${weekEntries.map(([week, events]) => `
        <div class="sheet-week">
          <div class="week-label">WEEK ${week}</div>
          ${events.map(e => `<div class="sheet-row">
            <span class="sheet-row-name">${escapeHtml(e.event)}${e.details ? ` <span class="muted">(${escapeHtml(e.details)})</span>` : ''}${e.otherPlayer ? ` <span class="muted">— ${escapeHtml(e.otherPlayer)}</span>` : ''}</span>
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
