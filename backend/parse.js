// Backend: turns CSV text from the Google Sheets into plain rows and records. No DOM.

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i <= text.length; i++) {
    const c = i < text.length ? text[i] : '\n';
    if (c === '"') {
      if (inQ && text[i + 1] === '"') { cell += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      row.push(cell); cell = '';
    } else if ((c === '\n' || c === '\r') && !inQ) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(v => v.trim())) rows.push(row);
      row = []; cell = '';
    } else {
      cell += c;
    }
  }
  return rows;
}

// Data rows as objects keyed by lowercased header, with trimmed values ("Other player " → r['other player'])
function sheetRecords(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).map(row => {
    const record = {};
    headers.forEach((h, i) => { record[h] = (row[i] || '').trim(); });
    return record;
  });
}

// Scoring sheet (columns: Category, Event, Points)
function parseScoringRules(rows) {
  const lookup = {};        // lowercased event → points
  const rules = [];         // shown on the scoring tab
  const hidden = new Set(); // lowercased events in the "Hidden" category — left out of the castaway event log
  sheetRecords(rows).forEach(({ category = '', event = '', points = '' }) => {
    if (event) lookup[event.toLowerCase()] = parseFloat(points) || 0;
    if (event && category.toLowerCase() === 'hidden') hidden.add(event.toLowerCase());
    if (category && event && points !== '0') rules.push({ category, event, points });
  });
  return { lookup, rules, hidden };
}

// Events sheet (columns: Week, Contestant, Event, Details, Other player, Tribe)
function parseEvents(rows) {
  return sheetRecords(rows).map(r => ({
    week: parseInt(r.week) || 0,
    contestant: r.contestant || '',
    event: r.event || '',
    details: r.details || '',
    otherPlayer: r['other player'] || '',
    tribe: r.tribe || '',
  }));
}

if (typeof module !== 'undefined') {
  module.exports = {
    parseCSV, sheetRecords, parseScoringRules, parseEvents,
  };
}
