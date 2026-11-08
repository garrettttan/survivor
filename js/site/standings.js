// Site: the standings table — one row per team, expanding to show its castaways.

// Places a team moved in the latest episode, shown beside its rank: ▲ up, ▼ down, nothing if it held. Nothing
// after episode 1 (no earlier place to compare) or once the season is finished (the final standings are what count).
function rankChangeHtml(tm, { episodeCount, finished }) {
  const last = episodeCount - 1;
  if (finished || last < 1) return '';
  const moved = tm.rankByEpisode[last - 1] - tm.rankByEpisode[last];
  return moved > 0 ? `<span class="rank-change rank-up">▲${moved}</span>`
    : moved < 0 ? `<span class="rank-change rank-down">▼${-moved}</span>` : '';
}

// A finished season counts each team's members instead of who's still active (only finalists are), and winner
// picks show whether they won
function renderStandings(data) {
  const { teams, teamNames, finished } = data;
  document.querySelector('#standings .count-col').textContent = finished ? 'Members' : 'Active';
  const sorted = [...teamNames].sort((a, b) => teams[b].points - teams[a].points);
  document.getElementById('standings-body').innerHTML = sorted.map((t, i) => {
    const tm = teams[t];
    const rank = i + 1;
    const guess = tm.winnerPick;
    // Live: 🟢 while the pick is still in, ☠️ once they're out. Finished: ✅ if they won, ❌ if not.
    const guessGood = finished ? guess?.finish === 'winner' : guess?.active;
    const guessMark = finished ? (guessGood ? '✅' : '❌') : (guessGood ? '🟢' : '☠️');
    const guessClass = guessGood ? 'guess-alive' : finished ? '' : 'guess-out';
    const guessSection = guess ? `
      <div class="roster-guess">🏆 <span class="${guessClass}">${escapeHtml(guess.name)}</span> ${guessMark}</div>` : '';

    // A finished season doesn't fade or cross out who went home
    const castawayRows = [...tm.members]
      .sort((a, b) => b.active - a.active || b.points - a.points)
      .map(c => {
        const shown = c.active || finished;
        return `<div class="castaway-row clickable-row ${shown ? '' : 'out'}" data-castaway="${escapeHtml(c.name)}">
          <div class="castaway-name clickable">${escapeHtml(c.name)}</div>
          <div class="castaway-end">
            <div class="castaway-pts" style="color:${shown ? tm.color : 'var(--muted)'}">${fmt(c.points)}</div>
            ${ICONS.chevronRight}
          </div>
        </div>`;
      }).join('');

    return `<tr class="team-row" style="--team:${tm.color}" aria-expanded="false">
      <td class="fit-col"><span class="rank-num" style="color:${rank === 1 ? 'var(--fire)' : 'var(--muted)'}">${rank === 1 ? '🔥' : rank}</span>${rankChangeHtml(tm, data)}</td>
      <td><span class="player-name" style="color:${tm.color}">${escapeHtml(t)}</span></td>
      <td class="fit-col"><span class="active-count">${finished ? tm.members.length : tm.activeCount}</span></td>
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
