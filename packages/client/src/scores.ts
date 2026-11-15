// The Hall of Fame (L): one row per map played, kept separately for Training and Tournament games. It grew from the
// original's dialog (Level, Map Name, Time, Winner, Draws, Player 1 Wins, Player 2 Wins, Total Games): the wins
// are counted per side (Brown, Green, Blue, Red: every base on a winning team gets one), and each row says how many
// bases its map has. Time is the fastest win on the map and Winner the side that set it. Rows live in localStorage.

export type ScoreMode = 'training' | 'tournament';

export interface ScoreRow {
  mapId: string;
  level: number;
  mapName: string;
  /** The fastest win, in milliseconds of game time, or null before anyone has won. */
  time: number | null;
  winner: string;
  draws: number;
  /** Wins by base: Brown, Green, Blue, Red. Rows from before 3- and 4-base maps have two. */
  wins: number[];
  total: number;
  /** The map's bases; missing on rows from before they were kept (two). */
  bases?: number;
}

export type ScoreTable = Record<ScoreMode, ScoreRow[]>;

const KEY = 'rfw.hallOfFame';

export function loadScores(): ScoreTable {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ScoreTable>;
    return { training: Array.isArray(t.training) ? t.training : [], tournament: Array.isArray(t.tournament) ? t.tournament : [] };
  } catch {
    return { training: [], tournament: [] };
  }
}

/** How a finished game went: the winning bases (one, or a team of them), none for a draw, and who they were. */
export interface GameResult {
  mode: ScoreMode;
  mapId: string;
  level: number;
  mapName: string;
  bases: number;
  winners: number[];
  winnerName: string;
  ms: number;
}

/** Adds a finished game to its map's row, and returns the updated table. */
export function recordGame(table: ScoreTable, r: GameResult): ScoreTable {
  const rows = table[r.mode];
  let row = rows.find((x) => x.mapId === r.mapId);
  if (!row) {
    row = { mapId: r.mapId, level: r.level, mapName: r.mapName, time: null, winner: '', draws: 0, wins: [], total: 0 };
    rows.push(row);
  }
  row.bases = r.bases;
  row.total++;
  if (!r.winners.length) row.draws++;
  else {
    for (const b of r.winners) row.wins[b] = (row.wins[b] ?? 0) + 1;
    if (row.time === null || r.ms < row.time) {
      row.time = r.ms;
      row.winner = r.winnerName;
    }
  }
  rows.sort((a, b) => a.level - b.level || a.mapId.localeCompare(b.mapId));
  return table;
}

export function saveScores(table: ScoreTable): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(table));
  } catch {
    // Not remembered when storage is unavailable.
  }
}

/** Game time as the dialog shows it, m:ss. */
export function formatTime(ms: number | null): string {
  if (ms === null) return '';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
