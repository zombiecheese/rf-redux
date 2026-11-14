// The Hall of Fame (F7): one row per map played, kept separately for Training and Tournament games, with the
// columns of the original's dialog (RFireEng.dll): Level, Map Name, Time, Winner, Draws, Player 1 Wins, Player 2
// Wins, Total Games. The original's update code is not in the decompiled build, so how the columns fill is
// inferred: Time is the fastest win on the map and Winner the name that set it. Rows live in localStorage until
// accounts hold them on the server (the leaderboards card).

export type ScoreMode = 'training' | 'tournament';

export interface ScoreRow {
  mapId: string;
  level: number;
  mapName: string;
  /** The fastest win, in milliseconds of game time, or null before anyone has won. */
  time: number | null;
  winner: string;
  draws: number;
  wins: [number, number];
  total: number;
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

/** How a finished game went: the winning side (0 Brown, 1 Green) or null for a draw. */
export interface GameResult {
  mode: ScoreMode;
  mapId: string;
  level: number;
  mapName: string;
  winner: 0 | 1 | null;
  names: [string, string];
  ms: number;
}

/** Adds a finished game to its map's row, and returns the updated table. */
export function recordGame(table: ScoreTable, r: GameResult): ScoreTable {
  const rows = table[r.mode];
  let row = rows.find((x) => x.mapId === r.mapId);
  if (!row) {
    row = { mapId: r.mapId, level: r.level, mapName: r.mapName, time: null, winner: '', draws: 0, wins: [0, 0], total: 0 };
    rows.push(row);
  }
  row.total++;
  if (r.winner === null) row.draws++;
  else {
    row.wins[r.winner]++;
    if (row.time === null || r.ms < row.time) {
      row.time = r.ms;
      row.winner = r.names[r.winner];
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
