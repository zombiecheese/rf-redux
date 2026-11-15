// The results screen after every match, offline and online: who won, how long it took, and each player's flags,
// losses and vehicles left. Offline it offers a rematch and the match's replay; online it goes back to the lobby.

import type { MatchResult, MatchStart } from '@rfw/net';
import { TICK_MS } from '@rfw/sim';
import { dialog, el } from './dialogs.js';
import type { ResultRow } from './game.js';
import { formatTime } from './scores.js';

const TEAMS = 'ABCD';

export interface ResultsView {
  title: string;
  ms: number;
  rows: readonly ResultRow[];
  /** The winning team, for the WIN marks; null for a draw. */
  winner: number | null;
  /** A line under the time, such as where the replay went. */
  note?: string;
}

/** The winner's line: one player by name, or a team of them. */
export function winnerTitle(rows: readonly ResultRow[], winner: number | null, team = false): string {
  if (winner === null) return 'A draw';
  const names = rows.filter((r) => r.team === winner).map((r) => r.name);
  if (names.length === 1) return `${names[0]} wins`;
  return team ? `Team ${TEAMS[winner]} wins` : `${names.join(' and ')} win`;
}

/** Shows the results and resolves with the pressed button's value (null for Esc or the close box). */
export function resultsScreen(v: ResultsView, buttons: [string, string][]): Promise<string | null> {
  // The team column only says something when a team has more than one player in it.
  const teams = new Set(v.rows.map((r) => r.team)).size < v.rows.length;
  const rows = [...v.rows].sort((a, b) => a.team - b.team).map((r) => el('tr', { class: r.you ? 'picked' : '' },
    el('td', { class: 'mark' }, r.team === v.winner ? 'WIN' : ''),
    ...(teams ? [el('td', {}, `Team ${TEAMS[r.team]!}`)] : []),
    el('td', {}, r.name + (r.bot ? ' (computer)' : '') + (r.quit ? ' (left)' : '')),
    ...[r.captures, r.lost, r.left].map((n) => el('td', { class: 'num' }, String(n)))));
  const head = ['', ...(teams ? ['Team'] : []), 'Player', 'Flags', 'Lost', 'Left'];
  const grid = el('table', { class: 'grid results' },
    el('thead', {}, el('tr', {}, ...head.map((h) => el('th', {}, h)))), el('tbody', {}, ...rows));
  const sub = `Time ${formatTime(v.ms)}${v.note ? `  ·  ${v.note}` : ''}`;
  return dialog('Results', el('div', { class: 'stack' }, el('div', { class: 'result-title' }, v.title), el('span', { class: 'hint' }, sub),
    el('div', { class: 'scroll' }, grid),
    el('span', { class: 'hint' }, 'Flags: enemy flags brought home. Lost: vehicles destroyed. Left: vehicles still in the bunker.')), buttons);
}

/** An online match's results, from the server's count. */
export function onlineView(r: MatchResult, start: MatchStart): ResultsView {
  const rows: ResultRow[] = r.seats.map((s) => ({
    name: s.name, team: s.team, lost: s.lost, captures: s.captures, left: s.left, you: s.player === start.you, bot: s.bot, quit: s.quit,
  }));
  const title = r.aborted ? `Game over: ${r.aborted}` : (r.timeLimit ? 'Time limit: ' : '') + winnerTitle(rows, r.winner, true);
  return { title, ms: r.ticks * TICK_MS, rows, winner: r.aborted ? null : r.winner };
}
