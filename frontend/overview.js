// Frontend: the game overview table — every castaway, sortable, with an active-only filter.

let overviewActiveOnly = true;
let overviewMultiSort = false; // taps add sort levels (like Shift-click)
let overviewSort = [{ key: 'points', dir: 'desc' }]; // ordered sort levels

// Sortable columns: default direction and the value compared
const OVERVIEW_SORTS = {
  name:   { dir: 'asc',  val: c => c.name },
  tribe:  { dir: 'asc',  val: c => c.tribes.length ? c.tribes[c.tribes.length - 1].tribeName : '' },
  points: { dir: 'desc', val: c => c.points },
  teams:  { dir: 'asc',  val: c => c.teams.join(', ') },
  // The winner, then everyone still in, then eliminated in reverse order (last out first)
  status: { dir: 'desc', val: c => c.finish === 'winner' ? 10000 : c.active ? 9999 : (c.exitEpisode ?? 999) },
};

function renderOverviewTable({ castaways, merged, finished }) {
  // Built from every castaway, not the filtered subset, so short names don't change when filtering
  const short = shortNames(castaways);
  const rows = overviewActiveOnly ? castaways.filter(c => c.active) : [...castaways];
  rows.sort((a, b) => {
    for (const { key, dir } of overviewSort) {
      const va = OVERVIEW_SORTS[key].val(a), vb = OVERVIEW_SORTS[key].val(b);
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      if (cmp) return dir === 'asc' ? cmp : -cmp;
    }
    return a.name.localeCompare(b.name);
  });

  document.getElementById('overview-body').innerHTML = rows.map(c => {
    const tribeHtml = [...c.tribes].reverse()
      .map((t, i) => tribeBadge(t, merged || i > 0))
      .join(' ');

    const advValues = c.advantages;
    const advHtml = advValues.length
      ? advValues.map(a => `<span class="badge badge-adv">${escapeHtml(a)}</span>`).join(' ')
      : '<span class="muted">—</span>';

    const statusHtml = c.finish === 'winner' ? '🏆 Winner'
      : c.finish === 'finalist' ? 'Finalist'
      : c.active ? '🟢'
      : (c.exitEpisode != null ? `☠️ Ep ${c.exitEpisode}` : '☠️');

    // A finished season doesn't fade or cross out who went home: everyone's finish is in the Status column
    return `<tr class="clickable-row ${c.active || finished ? '' : 'out'}" data-castaway="${escapeHtml(c.name)}">
      <td><span class="castaway-name-cell clickable"><span class="name-full">${escapeHtml(c.name)}</span><span class="name-short">${escapeHtml(short.get(c.name))}</span></span></td>
      <td><div class="overview-badges">${tribeHtml}</div></td>
      <td><span class="points-cell">${fmt(c.points)}</span></td>
      <td><div class="overview-badges">${advHtml}</div></td>
      <td>${c.teams.map(teamNameHtml).join(', ')}</td>
      <td>${statusHtml}</td>
    </tr>`;
  }).join('');

  updateOverviewSortIndicators();
}

function updateOverviewSortIndicators() {
  document.querySelectorAll('#overview-table th.sortable').forEach(th => {
    th.querySelector('.sort-ind')?.remove();
    const level = overviewSort.findIndex(s => s.key === th.dataset.sort);
    if (level === -1) return;
    const arrow = overviewSort[level].dir === 'asc' ? '▲' : '▼';
    const num = overviewSort.length > 1 ? `<sup>${level + 1}</sup>` : '';
    th.insertAdjacentHTML('beforeend', `<span class="sort-ind">${arrow}${num}</span>`);
  });
}

// Click: sort by this column alone (click again to reverse).
// Shift-click or Multi-sort on: add as next level → reverse → remove.
function onOverviewHeaderClick(e, key) {
  const additive = e.shiftKey || overviewMultiSort;
  const flip = dir => dir === 'asc' ? 'desc' : 'asc';
  const existing = overviewSort.find(s => s.key === key);
  if (!additive) {
    overviewSort = [{
      key,
      dir: existing && overviewSort.length === 1 ? flip(existing.dir) : OVERVIEW_SORTS[key].dir,
    }];
  } else if (!existing) {
    overviewSort.push({ key, dir: OVERVIEW_SORTS[key].dir });
  } else if (existing.dir === OVERVIEW_SORTS[key].dir) {
    existing.dir = flip(existing.dir);
  } else if (overviewSort.length > 1) {
    overviewSort = overviewSort.filter(s => s !== existing);
  } else {
    existing.dir = flip(existing.dir);
  }
  renderOverviewTable(appData);
}

// A finished season shows everyone, sorted by how far they got, with no Active only switch (nobody is still playing)
function renderOverviewFilters({ finished }) {
  if (finished) {
    overviewActiveOnly = false;
    overviewSort = [{ key: 'status', dir: OVERVIEW_SORTS.status.dir }];
  }
  document.getElementById('overview-filters').innerHTML = `
    ${finished ? '' : `<div class="toggle-wrap ${overviewActiveOnly ? 'on' : ''}" data-toggle="activeOnly">
      <div class="toggle-track"><div class="toggle-thumb"></div></div>
      <span class="toggle-label">Active only</span>
    </div>`}
    <div class="toggle-wrap ${overviewMultiSort ? 'on' : ''}" data-toggle="multiSort">
      <div class="toggle-track"><div class="toggle-thumb"></div></div>
      <span class="toggle-label">Multi-sort</span>
    </div>
    <span class="sort-hint">Tap a header to sort · Turn on Multi-sort to add levels</span>`;
}

document.querySelector('#overview-table thead').addEventListener('click', e => {
  const th = e.target.closest('th[data-sort]');
  if (th) onOverviewHeaderClick(e, th.dataset.sort);
});

document.getElementById('overview-filters').addEventListener('click', e => {
  const toggle = e.target.closest('[data-toggle]');
  if (!toggle) return;
  if (toggle.dataset.toggle === 'activeOnly') {
    overviewActiveOnly = !overviewActiveOnly;
    renderOverviewTable(appData);
  } else {
    overviewMultiSort = !overviewMultiSort;
  }
  // Flip the class rather than re-rendering, so the switch's thumb and colors animate (styles.css .toggle-*)
  toggle.classList.toggle('on');
});
