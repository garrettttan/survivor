// Frontend: the "standings over time" line chart (Chart.js).

let teamChartInst = null;

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

function renderTeamChart({ teams, teamNames, episodes }) {
  const labels = episodes.map(ep => `Ep ${ep.num}`);
  const datasets = teamNames.map(t => ({
    label: t,
    data: teams[t].cumulativePoints,
    borderColor: teams[t].color,
    backgroundColor: teams[t].color + '18',
    borderWidth: 2.5,
    pointRadius: 4,
    pointHoverRadius: 6,
    tension: 0.3,
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
  teamChartInst = new Chart(ctx, { type: 'line', data: { labels, datasets }, options: opts });
}
