// Frontend: the standings table — one row per team, expanding to show its castaways.

// A finished season drops the Active column (only finalists are left), and winner picks show whether they won
function renderStandings({ teams, teamNames, finished }) {
  document.querySelector('#standings .standings-table').classList.toggle('finished', finished);
  const sorted = [...teamNames].sort((a, b) => teams[b].points - teams[a].points);
  document.getElementById('standings-body').innerHTML = sorted.map((t, i) => {
    const tm = teams[t];
    const rank = i + 1;
    const guess = tm.winnerPick;
    const guessAlive = guess && guess.active;

    const guessGood = finished ? guess?.finish === 'winner' : guessAlive;
    const guessMark = finished ? (guessGood ? '✅' : '❌') : (guessAlive ? '🟢' : '☠️');
    const guessSection = guess ? `
      <div class="roster-guess">🏆 <span class="${guessGood ? 'guess-alive' : 'guess-out'}">${escapeHtml(guess.name)}</span> ${guessMark}</div>` : '';

    const castawayRows = [...tm.members]
      .sort((a, b) => b.active - a.active || b.points - a.points)
      .map(c => `<div class="castaway-row clickable-row ${c.active ? '' : 'out'}" data-castaway="${escapeHtml(c.name)}">
          <div class="castaway-name clickable">${escapeHtml(c.name)}</div>
          <div class="castaway-end">
            <div class="castaway-pts" style="color:${c.active ? tm.color : 'var(--muted)'}">${fmt(c.points)}</div>
            ${ICONS.chevronRight}
          </div>
        </div>`).join('');

    return `<tr class="team-row" style="--team:${tm.color}" aria-expanded="false">
      <td class="fit-col"><span class="rank-num" style="color:${rank === 1 ? 'var(--fire)' : 'var(--muted)'}">${rank === 1 ? '🔥' : rank}</span></td>
      <td><span class="color-dot" style="background:${tm.color}"></span><span class="player-name">${escapeHtml(t)}</span></td>
      <td class="fit-col active-col"><span class="active-count">${tm.activeCount}</span></td>
      <td class="fit-col points-col"><span class="points-cell" style="color:${tm.color}">${fmt(tm.points)}</span></td>
      <td class="expand-cell"><span class="expand-btn">${ICONS.chevronDown}</span></td>
    </tr>
    <tr class="team-detail" aria-hidden="true">
      <td colspan="5"><div class="detail-wrap"><div class="detail-inner"><div class="detail-pad">
        <div class="team-card" style="border-left:3px solid ${tm.color}">${guessSection}${castawayRows}</div>
      </div></div></div></td>
    </tr>`;
  }).join('');
}

// Toggle a team row to show its castaways
document.getElementById('standings-body').addEventListener('click', e => {
  const row = e.target.closest('tr.team-row');
  if (!row) return;
  const open = row.classList.toggle('open');
  row.setAttribute('aria-expanded', open);
  row.nextElementSibling.setAttribute('aria-hidden', !open);
});
