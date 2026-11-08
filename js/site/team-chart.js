// Site: the "standings over time" line chart (Chart.js).

let teamChartInst = null;
let teamChartShowRank = false; // the selector: running points (default) or each team's place after every episode
let teamChartFocus = null;      // the team picked in the legend, drawn on top with the others faded; null = none

// Chart.js options in the page's fonts and colors (read from the CSS variables in styles.css)
function baseChartOptions() {
  const css = getComputedStyle(document.documentElement);
  const v = name => css.getPropertyValue(name).trim();
  return {
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },   // the team chips above the chart instead (renderTeamChartLegend)
      tooltip: {
        backgroundColor: v('--card-bg'),
        borderColor: v('--card-border'),
        borderWidth: 1,
        titleColor: v('--text'),
        bodyColor: v('--muted'),
        callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}` },
      },
    },
    scales: {
      x: { ticks: { color: v('--muted'), font: { family: 'Oswald' } }, grid: { color: v('--card-border') } },
      y: { ticks: { color: v('--muted'), font: { family: 'Oswald' } }, grid: { color: v('--card-border') } },
    },
  };
}

// 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd"
function ordinal(n) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return n + suffix;
}

// Two-option selector above the chart: scores (default) or ranks. Rendered once; a choice only updates its
// attributes, so the highlight can slide across (styles.css .segmented::before).
function renderTeamChartControls() {
  const option = (rank, label) =>
    `<button type="button" data-rank="${rank}" aria-pressed="${teamChartShowRank === rank}">${label}</button>`;
  document.getElementById('team-chart-controls').innerHTML = `
    <div class="segmented" role="group" aria-label="Chart view" data-selected="${teamChartShowRank ? 1 : 0}">
      ${option(false, 'Scores')}${option(true, 'Ranks')}
    </div>`;
}

// Switch between scores and ranks
document.getElementById('team-chart-controls').addEventListener('click', e => {
  const btn = e.target.closest('[data-rank]');
  if (!btn || (btn.dataset.rank === 'true') === teamChartShowRank) return;
  teamChartShowRank = btn.dataset.rank === 'true';
  const group = btn.parentElement;
  group.dataset.selected = teamChartShowRank ? 1 : 0;
  group.querySelectorAll('[data-rank]').forEach(b => b.setAttribute('aria-pressed', b === btn));
  renderTeamChart(appData);
});

// The legend: a chip per team in standings order, outside the chart's sideways scroll so it's always in view.
// Tapping one highlights that team's line; tapping it again shows every team evenly.
function renderTeamChartLegend({ teams, teamNames }) {
  const sorted = [...teamNames].sort((a, b) => teams[b].points - teams[a].points);
  const el = document.getElementById('team-chart-legend');
  el.innerHTML = sorted.map(t => `<button type="button" class="team-chip" data-team="${escapeHtml(t)}"
      style="--team:${teams[t].color};--team-tint:${hexToRgba(teams[t].color, 0.12)}" aria-pressed="${teamChartFocus === t}">
      <span class="team-chip-dot"></span>${escapeHtml(t)}</button>`).join('');
  el.classList.toggle('has-focus', teamChartFocus !== null);
}

document.getElementById('team-chart-legend').addEventListener('click', e => {
  const chip = e.target.closest('[data-team]');
  if (!chip) return;
  teamChartFocus = teamChartFocus === chip.dataset.team ? null : chip.dataset.team;
  renderTeamChartLegend(appData);
  if (teamChartInst) {
    teamChartInst.data.datasets.forEach(d => Object.assign(d, focusStyle(d.label, appData.teams[d.label].color)));
    teamChartInst.update();
  }
});

// A team's line style given the legend's focus: the focused team thicker and on top (Chart.js draws the lowest
// `order` last), the rest faded
function focusStyle(team, color) {
  const faded = teamChartFocus !== null && teamChartFocus !== team;
  const focused = teamChartFocus === team;
  const line = faded ? hexToRgba(color, 0.18) : color;
  return {
    borderColor: line,
    pointBackgroundColor: line,
    pointBorderColor: line,
    borderWidth: focused ? 3.5 : 2.5,
    pointRadius: faded ? 1.5 : focused ? 3.5 : 2.5,
    order: focused ? -1 : 0,
  };
}

// One line per team across every episode, redrawn from scratch each time (Chart.js can't change scales in place)
function renderTeamChart({ teams, teamNames, episodeCount }) {
  const labels = Array.from({ length: episodeCount }, (_, i) => `Ep ${i + 1}`);
  const datasets = teamNames.map(t => ({
    label: t,
    data: teamChartShowRank ? teams[t].rankByEpisode : teams[t].cumulativePoints,
    backgroundColor: teams[t].color + '18',
    cubicInterpolationMode: 'monotone', // smooth, but never bends past a point (no fake dips, nothing above 1st)
    pointHoverRadius: 5,
    clip: false, // in rank view, don't cut the 1st and last place lines in half at the chart's edges
    ...focusStyle(t, teams[t].color),
  }));
  // Set min-width so the chart is scrollable on mobile for many episodes
  const inner = document.querySelector('.team-chart-inner');
  const perEpisode = isPhone() ? 40 : 50;
  inner.style.minWidth = Math.max(labels.length * perEpisode, 300) + 'px';

  const ctx = document.getElementById('team-chart').getContext('2d');
  if (teamChartInst) teamChartInst.destroy();
  const opts = baseChartOptions();
  opts.maintainAspectRatio = false;
  opts.plugins.tooltip.itemSort = (a, b) => b.parsed.y - a.parsed.y;
  if (teamChartShowRank) {
    // 1st at the top; the tooltip notes ties and gives the points behind each place
    opts.scales.y = {
      ...opts.scales.y,
      reverse: true,
      min: 1,
      max: teamNames.length,
      ticks: { ...opts.scales.y.ticks, stepSize: 1, callback: ordinal },
    };
    opts.plugins.tooltip.itemSort = (a, b) => a.parsed.y - b.parsed.y;
    opts.plugins.tooltip.callbacks.label = ctx => {
      const rank = ctx.parsed.y;
      const tied = teamNames.filter(t => teams[t].rankByEpisode[ctx.dataIndex] === rank).length > 1;
      const points = teams[ctx.dataset.label].cumulativePoints[ctx.dataIndex];
      return ` ${ctx.dataset.label}: ${tied ? 'T-' : ''}${ordinal(rank)} (${points} pts)`;
    };
  }
  teamChartInst = new Chart(ctx, { type: 'line', data: { labels, datasets }, options: opts });
}
