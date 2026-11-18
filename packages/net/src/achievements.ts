// Achievements: fifty things a player can earn, shared by the client (offline matches, the menus) and the server
// (online matches, and the account that keeps a signed-in player's progress).
//
// A MatchTracker watches one match's events for the players it is told to follow and, at the end, gives each of
// them a tally: counters to add (vehicles destroyed, flags captured...), sets to add to (maps won on) and one-off
// achievements earned. award() folds a tally into a player's Progress and says what it unlocked. Offline the
// client runs the tracker; online only the server does, and only the server may award the online achievements or
// touch their counters (ONLINE_ONLY), so they cannot be claimed from a browser.

import {
  DEATH_MISSILE, TICK_MS, VEHICLE_KINDS, type Match, type MatchEvent, type PlayerState, type VehicleKind,
} from '@rfw/sim';

export type AchievementGroup = 'missions' | 'combat' | 'demolition' | 'flags' | 'vehicles' | 'online' | 'extras';

export interface Achievement {
  id: string;
  name: string;
  /** What earns it. */
  text: string;
  group: AchievementGroup;
  /** For one earned by reaching a number: the counter (or set) and how many it takes. */
  counter?: string;
  set?: string;
  goal?: number;
  /** Awarded only by the server, from online matches. */
  online?: true;
  /** Kept secret (name, what earns it and progress) until unlocked: the hardest ones. */
  hidden?: true;
  /** What a hidden one shows instead of its description: a hint at how to earn it. */
  clue?: string;
}

export const GROUPS: { id: AchievementGroup; name: string }[] = [
  { id: 'missions', name: 'Missions' }, { id: 'combat', name: 'Combat' }, { id: 'demolition', name: 'Demolition' },
  { id: 'flags', name: 'Flags' }, { id: 'vehicles', name: 'Vehicles' }, { id: 'online', name: 'Online' }, { id: 'extras', name: 'Extras' },
];

const a = (group: AchievementGroup, id: string, name: string, text: string, more: Partial<Achievement> = {}): Achievement => ({ id, name, text, group, ...more });

export const ACHIEVEMENTS: readonly Achievement[] = [
  a('missions', 'first-match', 'Reporting for Duty', 'Finish a match.'),
  a('missions', 'first-win', 'First Victory', 'Win a match.'),
  a('missions', 'wins-25', 'Veteran', 'Win 25 matches.', { counter: 'wins', goal: 25 }),
  a('missions', 'wins-100', 'War Hero', 'Win 100 matches.', { counter: 'wins', goal: 100, hidden: true, clue: 'A century of victories makes a legend.' }),
  a('missions', 'top-brass', 'Top Brass', 'Win against the computer at skill 9.', { hidden: true, clue: 'Outwit the computer at its very sharpest.' }),
  a('missions', 'flawless', 'Not a Scratch', 'Win a match without losing a vehicle.', { hidden: true, clue: 'Come home with every vehicle you took out.' }),
  a('missions', 'blitz', 'Blitzkrieg', 'Win a match in under five minutes.', { hidden: true, clue: 'Some wars are over before the coffee is cold.' }),
  a('missions', 'last-jeep', 'By a Thread', 'Win with no jeeps left in the bunker.', { hidden: true, clue: 'Win it with your final set of wheels.' }),
  a('missions', 'night-win', 'Night Owl', 'Win a match at night.'),
  a('missions', 'three-base', 'Three\'s a Crowd', 'Win on a map with three bases.'),
  a('missions', 'four-base', 'Last One Standing', 'Win a four-base free-for-all.'),
  a('missions', 'tour', 'Tour of Duty', 'Win on 10 different maps.', { set: 'maps', goal: 10 }),
  a('missions', 'custom-map', 'Off the Beaten Track', 'Win on a map from the library or the level editor.'),
  a('missions', 'split-screen', 'Couch Commanders', 'Finish a two-player split-screen match.'),

  a('combat', 'first-blood', 'First Blood', 'Destroy an enemy vehicle.'),
  a('combat', 'kills-50', 'Scrap Dealer', 'Destroy 50 enemy vehicles.', { counter: 'kills', goal: 50 }),
  a('combat', 'kills-250', 'Wrecking Crew', 'Destroy 250 enemy vehicles.', { counter: 'kills', goal: 250, hidden: true, clue: 'Keep the scrapyards busy for a very long time.' }),
  a('combat', 'tanks-25', 'Tank Hunter', 'Destroy 25 enemy tanks.', { counter: 'kills.tank', goal: 25 }),
  a('combat', 'helis-10', 'Clipped Wings', 'Shoot down 10 enemy helicopters.', { counter: 'kills.heli', goal: 10 }),
  a('combat', 'combined-arms', 'Combined Arms', 'Destroy an enemy vehicle with each of your four vehicles.', { set: 'killedFrom', goal: 4 }),
  a('combat', 'jeep-vs-tank', 'David and Goliath', 'Destroy a tank while driving a jeep.'),
  a('combat', 'hat-trick', 'Hat Trick', 'Destroy three enemy vehicles in one sortie.'),
  a('combat', 'rampage', 'Rampage', 'Destroy five enemy vehicles in one sortie.', { hidden: true, clue: 'Five in one go, and no trip back to the bunker.' }),
  a('combat', 'interception', 'Interception', 'Destroy the jeep carrying your flag.'),
  a('combat', 'drone-down', 'Swatter', 'Shoot down an attack drone.'),
  a('combat', 'drones-25', 'Pest Control', 'Shoot down 25 attack drones.', { counter: 'drones', goal: 25 }),
  a('combat', 'soldiers-100', 'Body Count', 'Take out 100 enemy soldiers.', { counter: 'soldiers', goal: 100 }),

  a('demolition', 'tower-down', 'Tower Down', 'Destroy a gun tower.'),
  a('demolition', 'towers-50', 'Tower Toppler', 'Destroy 50 gun towers.', { counter: 'towers', goal: 50, hidden: true, clue: 'The skyline looks better without guns on it. Fifty times better.' }),
  a('demolition', 'buildings-500', 'Urban Renewal', 'Destroy 500 buildings.', { counter: 'buildings', goal: 500, hidden: true, clue: 'Flatten a small city, one block at a time.' }),
  a('demolition', 'prison', 'Jailbreak', 'Destroy an enemy prison.'),
  a('demolition', 'bridge', 'A Bridge Too Far', 'Destroy a bridge.'),
  a('demolition', 'fuel', 'Fireworks', 'Blow up an enemy fuel depot.'),
  a('demolition', 'crush-50', 'Lawnmower', 'Flatten 50 bushes, trees, planters or tents.', { counter: 'crushed', goal: 50 }),

  a('flags', 'flag-take', 'Snatch and Grab', 'Pick up an enemy flag.'),
  a('flags', 'flag-capture', 'Capture the Flag', 'Bring an enemy flag home.'),
  a('flags', 'flags-10', 'Flag Collector', 'Capture 10 enemy flags.', { counter: 'captures', goal: 10 }),
  a('flags', 'flag-return', 'Homecoming', 'Bring your own flag back home.'),

  a('vehicles', 'all-vehicles', 'Full Motor Pool', 'Launch all four vehicles in one match.'),
  a('vehicles', 'tyres', 'Amphibious', 'Blow up the jeep\'s tyres and float.'),
  a('vehicles', 'mines-50', 'Minefield', 'Lay 50 mines with the ASV.', { counter: 'mines', goal: 50 }),
  a('vehicles', 'sub', 'Here Be Monsters', 'Lose a helicopter to the submarine.'),
  a('vehicles', 'drowned', 'Davy Jones', 'Sink a vehicle in deep water.'),

  a('online', 'online-first', 'Going Live', 'Finish an online match.', { online: true }),
  a('online', 'online-win', 'Online Victory', 'Win an online match against another player.', { online: true }),
  a('online', 'team-win', 'Brothers in Arms', 'Win an online match alongside another player.', { online: true }),
  a('online', 'ladder', 'Climbing the Ladder', 'Reach a ladder rating of 1100.', { online: true, hidden: true, clue: 'Keep climbing the ranks until you reach eleven hundred.' }),

  a('extras', 'replay', 'Instant Replay', 'Watch a replay.'),
  a('extras', 'architect', 'Architect', 'Save a map in the level editor.'),
  a('extras', 'thermal', 'Heat Signature', 'Switch on the thermal camera at night.'),
];

export const ACHIEVEMENT_BY_ID: ReadonlyMap<string, Achievement> = new Map(ACHIEVEMENTS.map((x) => [x.id, x]));

/** Earned on the client by something done in the menus, not in a match. */
export const MENU_ACHIEVEMENTS = ['replay', 'architect', 'thermal'] as const;

/** Counters only the server keeps (from online matches): a browser's tallies never touch them. */
export const ONLINE_COUNTER = /^online\./;

/** A player's achievements so far: when each was unlocked (ms), and the running counters and sets. */
export interface Progress {
  unlocked: Record<string, number>;
  counters: Record<string, number>;
  sets: Record<string, string[]>;
}

/** What one match (or one menu action, or a guest's progress handed to an account) adds. */
export interface Tally {
  counters: Record<string, number>;
  sets: Record<string, string[]>;
  earned: string[];
}

export const emptyProgress = (): Progress => ({ unlocked: {}, counters: {}, sets: {} });
export const emptyTally = (): Tally => ({ counters: {}, sets: {}, earned: [] });

/** Largest count one tally may add, and longest a set may grow: a sanity bound on what a browser sends. */
export const MAX_COUNT = 5000;
export const MAX_SET = 200;
const MAX_KEY = 64;

/** Progress read from storage or the network that may be old, partial or hand-edited. */
export function cleanProgress(raw: unknown): Progress {
  const out = emptyProgress();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Partial<Progress>;
  if (r.unlocked && typeof r.unlocked === 'object') {
    for (const [id, at] of Object.entries(r.unlocked)) if (ACHIEVEMENT_BY_ID.has(id) && Number.isFinite(at)) out.unlocked[id] = Number(at);
  }
  if (r.counters && typeof r.counters === 'object') {
    for (const [k, n] of Object.entries(r.counters)) if (k.length <= MAX_KEY && Number.isFinite(n) && n > 0) out.counters[k] = Math.floor(Number(n));
  }
  if (r.sets && typeof r.sets === 'object') {
    for (const [k, v] of Object.entries(r.sets)) {
      if (k.length <= MAX_KEY && Array.isArray(v)) out.sets[k] = [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length <= MAX_KEY))].slice(0, MAX_SET);
    }
  }
  return out;
}

/**
 * A tally from somewhere that cannot be trusted with the online achievements (a browser): those and the online
 * counters are dropped, unknown ids too, and every number is bounded.
 */
export function cleanTally(raw: unknown, trusted = false): Tally {
  const out = emptyTally();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Partial<Tally>;
  if (r.counters && typeof r.counters === 'object') {
    for (const [k, n] of Object.entries(r.counters)) {
      if (k.length > MAX_KEY || (!trusted && ONLINE_COUNTER.test(k)) || !Number.isFinite(n) || n <= 0) continue;
      out.counters[k] = Math.min(MAX_COUNT, Math.floor(Number(n)));
    }
  }
  if (r.sets && typeof r.sets === 'object') {
    for (const [k, v] of Object.entries(r.sets)) {
      if (k.length > MAX_KEY || !Array.isArray(v)) continue;
      out.sets[k] = [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length <= MAX_KEY))].slice(0, MAX_SET);
    }
  }
  if (Array.isArray(r.earned)) {
    out.earned = [...new Set(r.earned.filter((id): id is string => typeof id === 'string' && ACHIEVEMENT_BY_ID.has(id) && (trusted || !ACHIEVEMENT_BY_ID.get(id)!.online)))];
  }
  return out;
}

/** How far a player is towards an achievement with a goal: [have, goal], or null for a one-off. */
export function progressOf(p: Progress, x: Achievement): [number, number] | null {
  if (!x.goal) return null;
  const have = x.counter ? p.counters[x.counter] ?? 0 : x.set ? (p.sets[x.set] ?? []).length : 0;
  return [Math.min(have, x.goal), x.goal];
}

/**
 * Adds a tally to a player's progress (in place) and returns the achievements it unlocked, in list order. An
 * untrusted tally (a browser's) can never unlock an online achievement.
 */
export function award(p: Progress, t: Tally, now = Date.now(), trusted = false): string[] {
  for (const [k, n] of Object.entries(t.counters)) {
    if (!trusted && ONLINE_COUNTER.test(k)) continue;
    p.counters[k] = (p.counters[k] ?? 0) + n;
  }
  for (const [k, v] of Object.entries(t.sets)) {
    const set = new Set(p.sets[k] ?? []);
    for (const x of v) if (set.size < MAX_SET) set.add(x);
    p.sets[k] = [...set];
  }
  const earned = new Set(t.earned);
  const fresh: string[] = [];
  for (const x of ACHIEVEMENTS) {
    if (p.unlocked[x.id] || (x.online && !trusted)) continue;
    const got = earned.has(x.id) || (!!x.goal && progressOf(p, x)![0] >= x.goal);
    if (got) {
      p.unlocked[x.id] = now;
      fresh.push(x.id);
    }
  }
  return fresh;
}

/** A guest's whole progress as one tally, to hand over to an account on signing in. */
export function progressAsTally(p: Progress): Tally {
  return { counters: { ...p.counters }, sets: Object.fromEntries(Object.entries(p.sets).map(([k, v]) => [k, [...v]])), earned: Object.keys(p.unlocked) };
}

// ---- Watching a match ----

export interface TrackOptions {
  /** offline: one player against the computer; split: two players on one screen; online: a server match. */
  mode: 'training' | 'split' | 'online';
  /** The map's id, for Tour of Duty, and whether it is a custom one (library or editor). */
  mapId: string;
  custom: boolean;
  /** At night (lighting). */
  night: boolean;
  /** The computer's skill. */
  difficulty: number;
  /** Player ids played by people (the rest are bots). */
  humans: readonly number[];
  /** Player ids played by the computer. */
  bots: readonly number[];
}

/** Gun towers, by building record name (the original's TOWER, LARGE_TOWER and their woken and damaged states). */
const GUN_TOWER = /^(TOWER|LARGE_TOWER|READY_TOWER|ACTIVE_TOWER|DMG_TOWER)$/;
/** What a vehicle can flatten by driving through it: bushes, trees, cacti, planters and tents. */
const SCENERY = /^(BUSH|PALM|TREE|CACTUS|PLANTER|TENT)/;

interface Watch {
  player: number;
  lost: boolean;
  /** Enemy vehicles destroyed since this player last came up from the bunker. */
  sortie: number;
  launched: Set<VehicleKind>;
  /** The vehicle last driven, for a kill made as it went down too. */
  driving: VehicleKind | null;
  tally: Tally;
}

const add = (t: Tally, key: string, n = 1) => {
  t.counters[key] = (t.counters[key] ?? 0) + n;
};
const addTo = (t: Tally, key: string, value: string) => {
  const v = (t.sets[key] ??= []);
  if (!v.includes(value)) v.push(value);
};
const earn = (t: Tally, id: string) => {
  if (!t.earned.includes(id)) t.earned.push(id);
};

/**
 * Follows a match tick by tick for some of its players. Call tick() after every tick (it reads that tick's events
 * and the players' states), then finish() once with the result. It never changes the match.
 */
export class MatchTracker {
  private readonly watches = new Map<number, Watch>();
  /** Who carries each base's flag. */
  private readonly carriers = new Map<number, number>();
  private states: PlayerState[];
  private done = false;

  constructor(m: Match, players: readonly number[], private readonly o: TrackOptions) {
    for (const p of players) {
      if (!m.players[p]) continue;
      this.watches.set(p, { player: p, lost: false, sortie: 0, launched: new Set(), driving: null, tally: emptyTally() });
    }
    this.states = m.players.map((p) => p.state);
  }

  private teamOfBase(m: Match, base: number): number {
    return m.players.find((p) => p.base === base)?.team ?? -1;
  }

  /** Reads one tick's events. */
  tick(m: Match): void {
    if (this.done) return;
    for (const w of this.watches.values()) {
      const p = m.players[w.player]!;
      const was = this.states[w.player];
      if (was === 'bunker' && p.state === 'launching' && p.elevator) w.launched.add(p.elevator.kind);
      if (p.state === 'bunker') w.sortie = 0;
      if (p.vehicle) w.driving = p.vehicle.kind;
      if (w.launched.size === VEHICLE_KINDS.length) earn(w.tally, 'all-vehicles');
    }
    for (const e of m.events) this.event(m, e);
    this.states = m.players.map((p) => p.state);
  }

  private event(m: Match, e: MatchEvent): void {
    switch (e.type) {
      case 'destroyed': {
        const victim = m.players[e.player]!;
        const killer = e.by !== undefined ? this.watches.get(e.by) : undefined;
        if (killer && m.players[killer.player]!.team !== victim.team) {
          const t = killer.tally;
          add(t, 'kills');
          add(t, `kills.${e.kind}`);
          earn(t, 'first-blood');
          const from = m.players[killer.player]!.vehicle?.kind ?? killer.driving;
          if (from) addTo(t, 'killedFrom', from);
          if (from === 'jeep' && e.kind === 'tank') earn(t, 'jeep-vs-tank');
          killer.sortie++;
          if (killer.sortie >= 3) earn(t, 'hat-trick');
          if (killer.sortie >= 5) earn(t, 'rampage');
          // The flag it carried was one of the killer's side's.
          for (const [base, carrier] of this.carriers) {
            if (carrier === e.player && this.teamOfBase(m, base) === m.players[killer.player]!.team) earn(t, 'interception');
          }
        }
        const own = this.watches.get(e.player);
        if (own) {
          if (!e.fuelOut) own.lost = true;
          own.sortie = 0;
          if (e.drowned) earn(own.tally, 'drowned');
          if (e.kind === 'heli' && e.shot === DEATH_MISSILE) earn(own.tally, 'sub');
        }
        break;
      }
      case 'buildingDestroyed': {
        const w = e.by !== undefined ? this.watches.get(e.by) : undefined;
        if (!w) break;
        const name = m.world.defs[e.building]?.name ?? '';
        const owner = m.world.owner[e.tile]!;
        const team = m.players[w.player]!.team;
        if (owner >= 0 && this.teamOfBase(m, owner) === team) break;
        if (e.crushed) {
          if (SCENERY.test(name)) add(w.tally, 'crushed');
          break;
        }
        add(w.tally, 'buildings');
        if (GUN_TOWER.test(name)) {
          add(w.tally, 'towers');
          earn(w.tally, 'tower-down');
        }
        if (/^PRISON/.test(name) && owner >= 0) earn(w.tally, 'prison');
        if (/^BRIGE/.test(name)) earn(w.tally, 'bridge');
        if (/^FUEL/.test(name) && owner >= 0) earn(w.tally, 'fuel');
        break;
      }
      case 'soldierKilled': {
        const w = e.by !== undefined ? this.watches.get(e.by) : undefined;
        if (w && (e.base < 0 || this.teamOfBase(m, e.base) !== m.players[w.player]!.team)) add(w.tally, 'soldiers');
        break;
      }
      case 'droneDown': {
        const w = e.by !== undefined ? this.watches.get(e.by) : undefined;
        if (!w) break;
        add(w.tally, 'drones');
        earn(w.tally, 'drone-down');
        break;
      }
      case 'flagTaken': {
        this.carriers.set(e.base, e.player);
        const w = this.watches.get(e.player);
        if (w && this.teamOfBase(m, e.base) !== m.players[e.player]!.team) earn(w.tally, 'flag-take');
        break;
      }
      case 'flagDropped':
        this.carriers.delete(e.base);
        break;
      case 'flagReturned': {
        this.carriers.delete(e.base);
        const w = this.watches.get(e.player);
        if (w) earn(w.tally, 'flag-return');
        break;
      }
      case 'captured': {
        this.carriers.delete(e.base);
        const w = this.watches.get(e.player);
        if (!w) break;
        add(w.tally, 'captures');
        earn(w.tally, 'flag-capture');
        break;
      }
      case 'tyres': {
        const w = this.watches.get(e.player);
        if (w && e.out) earn(w.tally, 'tyres');
        break;
      }
      case 'fired': {
        const w = e.player !== undefined && e.shot === 'mine' ? this.watches.get(e.player) : undefined;
        if (w) add(w.tally, 'mines');
        break;
      }
      default:
        break;
    }
  }

  /**
   * The tallies at the end of the match. winner is the winning team (null for a draw); aborted for a match that
   * was stopped (nothing is counted); quit names players who left (they get what they did, not the result).
   */
  finish(m: Match, winner: number | null, opts: { aborted?: boolean; quit?: readonly number[] } = {}): Map<number, Tally> {
    this.done = true;
    const out = new Map<number, Tally>();
    if (opts.aborted) return out;
    const teams = new Set(m.players.map((p) => p.team));
    const bases = m.world.bases.length;
    const ffa = teams.size === m.players.length;
    for (const w of this.watches.values()) {
      const t = w.tally;
      const p = m.players[w.player]!;
      out.set(w.player, t);
      if (opts.quit?.includes(w.player)) continue;
      add(t, 'games');
      earn(t, 'first-match');
      if (this.o.mode === 'split') earn(t, 'split-screen');
      const rivals = m.players.filter((q) => q.team !== p.team);
      const humanRivals = rivals.filter((q) => this.o.humans.includes(q.id));
      const botRivals = rivals.filter((q) => this.o.bots.includes(q.id));
      const teammates = m.players.filter((q) => q.team === p.team && q.id !== p.id && this.o.humans.includes(q.id));
      if (this.o.mode === 'online') {
        add(t, 'online.games');
        earn(t, 'online-first');
      }
      // A win counts against someone: the computer or another player.
      const won = winner !== null && winner === p.team && (humanRivals.length > 0 || botRivals.length > 0);
      if (!won) continue;
      add(t, 'wins');
      earn(t, 'first-win');
      if (!w.lost) earn(t, 'flawless');
      if (m.tick * TICK_MS < 5 * 60_000) earn(t, 'blitz');
      if (p.lives.jeep === 0) earn(t, 'last-jeep');
      if (this.o.night) earn(t, 'night-win');
      if (bases === 3) earn(t, 'three-base');
      if (bases === 4 && ffa) earn(t, 'four-base');
      addTo(t, 'maps', this.o.mapId);
      if (this.o.custom) earn(t, 'custom-map');
      if (this.o.difficulty >= 9 && botRivals.length > 0) earn(t, 'top-brass');
      if (this.o.mode === 'online') {
        add(t, 'online.wins');
        if (humanRivals.length) earn(t, 'online-win');
        if (teammates.length) earn(t, 'team-win');
      }
    }
    return out;
  }
}
