// Frontend: the "standings over time" line chart (Chart.js).

let teamChartInst = null;
let teamChartShowRank = false; // the selector: running points (default) or each team's place after every episode

function baseChartOptions() {
  const css = getComputedStyle(document.documentElement);
  const v = name => css.getPropertyValue(name).trim();
  return {
    responsive: true,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: v('--muted'), font: { family: 'Oswald', size: 11 }, boxWidth: 12 } },
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

document.getElementById('team-chart-controls').addEventListener('click', e => {
  const btn = e.target.closest('[data-rank]');
  if (!btn || (btn.dataset.rank === 'true') === teamChartShowRank) return;
  teamChartShowRank = btn.dataset.rank === 'true';
  const group = btn.parentElement;
  group.dataset.selected = teamChartShowRank ? 1 : 0;
  group.querySelectorAll('[data-rank]').forEach(b => b.setAttribute('aria-pressed', b === btn));
  renderTeamChart(appData);
});

function renderTeamChart({ teams, teamNames, episodeCount }) {
  const labels = Array.from({ length: episodeCount }, (_, i) => `Ep ${i + 1}`);
  const datasets = teamNames.map(t => ({
    label: t,
    data: teamChartShowRank ? teams[t].rankByEpisode : teams[t].cumulativePoints,
    borderColor: teams[t].color,
    backgroundColor: teams[t].color + '18',
    borderWidth: 2.5,
    cubicInterpolationMode: 'monotone', // smooth, but never bends past a point (no fake dips, nothing above 1st)
    pointRadius: 2.5,
    pointHoverRadius: 5,
    pointBackgroundColor: teams[t].color,
    pointBorderColor: teams[t].color,
    clip: false, // in rank view, don't cut the 1st and last place lines in half at the chart's edges
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
