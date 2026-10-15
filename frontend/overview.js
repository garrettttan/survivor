// Frontend: the game overview table — every castaway, sortable, with an active-only filter.

let overviewActiveOnly = true;
let overviewMultiSort = false; // taps add sort levels (like Shift-click)
let overviewSort = [{ key: 'points', dir: 'desc' }]; // ordered sort levels

// Sortable columns: default direction and the value compared
const OVERVIEW_SORTS = {
  name:   { dir: 'asc',  val: c => c.name },
  tribe:  { dir: 'asc',  val: c => c.tribes.length ? c.tribes[c.tribes.length - 1].value : '' },
  points: { dir: 'desc', val: c => c.total },
  teams:  { dir: 'asc',  val: c => c.teams.join(', ') },
  // Active castaways first, then eliminated in reverse order (last out first)
  status: { dir: 'desc', val: c => c.eliminated ? (c.eliminatedWeek ?? 999) : 9999 },
};

function renderOverviewTable({ castaways, merged }) {
  let subset = castaways;
  if (overviewActiveOnly) subset = subset.filter(c => !c.eliminated);

  // Group by castaway name, collecting every team that drafted them
  const byName = new Map();
  subset.forEach(c => {
    if (!byName.has(c.name)) {
      byName.set(c.name, { ...c, teams: [c.team] });
    } else {
      const entry = byName.get(c.name);
      if (!entry.teams.includes(c.team)) entry.teams.push(c.team);
    }
  });

  let unique = [...byName.values()];
  unique.sort((a, b) => {
    for (const { key, dir } of overviewSort) {
      const va = OVERVIEW_SORTS[key].val(a), vb = OVERVIEW_SORTS[key].val(b);
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      if (cmp) return dir === 'asc' ? cmp : -cmp;
    }
    return a.name.localeCompare(b.name);
  });

  document.getElementById('overview-body').innerHTML = unique.map(c => {
    const tribeValues = [...new Set(c.tribes.map(t => t.value))].reverse();
    const tribeHtml = tribeValues
      .map((v, i) => tribeBadge(v, merged || i > 0))
      .join(' ');

    const advValues = splitList(c.advantages);
    const advHtml = advValues.length
      ? advValues.map(a => `<span class="badge badge-adv">${escapeHtml(a)}</span>`).join(' ')
      : '<span class="muted">—</span>';

    const statusHtml = c.eliminated
      ? (c.eliminatedWeek != null ? `☠️ Wk ${c.eliminatedWeek}` : '☠️')
      : '🟢';

    return `<tr class="clickable-row ${c.eliminated ? 'out' : ''}" data-castaway="${escapeHtml(c.name)}">
      <td><span class="castaway-name-cell clickable">${escapeHtml(c.name)}</span></td>
      <td><div class="overview-badges">${tribeHtml}</div></td>
      <td><span class="points-cell">${fmt(c.total)}</span></td>
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

function renderOverviewFilters() {
  document.getElementById('overview-filters').innerHTML = `
    <div class="toggle-wrap ${overviewActiveOnly ? 'on' : ''}" data-toggle="activeOnly">
      <div class="toggle-track"><div class="toggle-thumb"></div></div>
      <span class="toggle-label">Active only</span>
    </div>
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
  renderOverviewFilters();
});
