// Every key the game answers to, in one place, so the controls, the shortcuts and Help Topics cannot drift apart.
// The two halves of the keyboard start as the original's Tournament layout and can be rebound (Options > Controls);
// nothing else (chat, the scoreboard, the menus' shortcuts) may use a key either half plays with, so the keys a
// player can bind exclude those (reservedKey).

export interface Controls {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  fire: string[];
  fire2: string[];
  fire3: string[];
  dock: string[];
  /** Tank turret swing; both together centre it. */
  turretLeft: string[];
  turretRight: string[];
  /** Launch keys, one list per vehicle in LAUNCH_ORDER (jeep, tank, ASV, helicopter). */
  launch: string[][];
}

/** Everything a half of the keyboard does, one key each: what Config > Controls lists and rebinds. */
export const ACTIONS = [
  'up', 'down', 'left', 'right', 'fire', 'fire2', 'fire3', 'turretLeft', 'turretRight', 'dock',
  'launchJeep', 'launchTank', 'launchAsv', 'launchHeli',
] as const;
export type Action = (typeof ACTIONS)[number];
export type Bindings = Record<Action, string>;
export type Half = 'left' | 'right';

const LAUNCH_ACTIONS: Action[] = ['launchJeep', 'launchTank', 'launchAsv', 'launchHeli'];

/** What each action is called in Config > Controls. */
export const ACTION_LABELS: Record<Action, string> = {
  up: 'Forward', down: 'Back', left: 'Turn left', right: 'Turn right', fire: 'Fire', fire2: 'Second button', fire3: 'Third button',
  turretLeft: 'Turret left', turretRight: 'Turret right', dock: 'Back into the bunker',
  launchJeep: 'Launch jeep', launchTank: 'Launch tank', launchAsv: 'Launch ASV', launchHeli: 'Launch helicopter',
};

/** The original's Tournament layout: Brown on the left half of the keyboard, Green on the right. */
export const DEFAULT_BINDINGS: Record<Half, Bindings> = {
  left: {
    up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', fire: 'Space', fire2: 'ShiftLeft', fire3: 'KeyF', turretLeft: 'KeyQ', turretRight: 'KeyE',
    dock: 'KeyR', launchJeep: 'Digit1', launchTank: 'Digit2', launchAsv: 'Digit3', launchHeli: 'Digit4',
  },
  right: {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', fire: 'Enter', fire2: 'ShiftRight', fire3: 'Slash',
    turretLeft: 'BracketLeft', turretRight: 'BracketRight', dock: 'Backspace', launchJeep: 'Digit7', launchTank: 'Digit8', launchAsv: 'Digit9',
    launchHeli: 'Digit0',
  },
};

export function controlsFrom(b: Bindings): Controls {
  return {
    up: [b.up], down: [b.down], left: [b.left], right: [b.right], fire: [b.fire], fire2: [b.fire2], fire3: [b.fire3], dock: [b.dock],
    turretLeft: [b.turretLeft], turretRight: [b.turretRight], launch: LAUNCH_ACTIONS.map((a) => [b[a]]),
  };
}

/** Both halves together, for a solo player. */
function merge(a: Controls, b: Controls): Controls {
  const both = (x: string[], y: string[]) => [...x, ...y];
  return {
    up: both(a.up, b.up), down: both(a.down, b.down), left: both(a.left, b.left), right: both(a.right, b.right), fire: both(a.fire, b.fire),
    fire2: both(a.fire2, b.fire2), fire3: both(a.fire3, b.fire3), dock: both(a.dock, b.dock), turretLeft: both(a.turretLeft, b.turretLeft),
    turretRight: both(a.turretRight, b.turretRight), launch: a.launch.map((k, i) => both(k, b.launch[i]!)),
  };
}

/** Brown in a two-player game (Green with Swap Sides), as the original laid it out. */
export const WASD: Controls = controlsFrom(DEFAULT_BINDINGS.left);
/** Green in a two-player game (Brown with Swap Sides), as the original laid it out. */
export const ARROWS: Controls = controlsFrom(DEFAULT_BINDINGS.right);
/** A solo player (Training, online, test play) can use either half of the keyboard, and the touch controls press these keys. */
export const SOLO: Controls = merge(WASD, ARROWS);

let bound: Record<Half, Bindings> = { left: { ...DEFAULT_BINDINGS.left }, right: { ...DEFAULT_BINDINGS.right } };
let version = 0;

/** Counts changes to the bindings, so a running match picks up keys changed from the menu. */
export function bindingsVersion(): number {
  return version;
}

/** The keys in use: the defaults, or what the player picked in Config > Controls. */
export function bindings(): Record<Half, Bindings> {
  return { left: { ...bound.left }, right: { ...bound.right } };
}

/**
 * Takes the player's own keys (from settings, which may be old or hand-edited): any action without a usable key,
 * or whose key clashes, falls back to its default.
 */
export function setBindings(custom: Partial<Record<Half, Partial<Bindings>>> | undefined): void {
  const next = { left: { ...DEFAULT_BINDINGS.left }, right: { ...DEFAULT_BINDINGS.right } };
  for (const half of ['left', 'right'] as const) {
    for (const a of ACTIONS) {
      const code = custom?.[half]?.[a];
      if (typeof code !== 'string' || code === next[half][a]) continue;
      const tried = rebind(next, half, a, code);
      if (typeof tried !== 'string') Object.assign(next, tried);
    }
  }
  bound = next;
  version++;
}

/** The keys each half of the keyboard plays with now, and both together for a solo player. */
export function activeControls(): { left: Controls; right: Controls; solo: Controls } {
  const left = controlsFrom(bound.left);
  const right = controlsFrom(bound.right);
  return { left, right, solo: merge(left, right) };
}

/** The key a touch control presses for an action: the left half's. */
export function touchKey(a: Action): string {
  return bound.left[a];
}

/** Keys no action may take, with the reason Config > Controls gives. */
export function reservedKey(code: string): string | null {
  if (/^F\d+$/.test(code)) return 'Function keys are not used (laptops hide them, browsers keep several)';
  if (/^(Alt|Control|Meta|OS|ContextMenu|CapsLock|NumLock|ScrollLock|Fn)/.test(code) || code === '' || code === 'Unidentified') return 'That key cannot be used';
  if (code === 'Escape' || code === 'Tab') return `${keyName(code)} is kept for the menus`;
  if (code === ONLINE_KEYS.chat) return `${keyName(code)} opens the chat line online`;
  const s = SHORTCUTS.find((x) => !x.alt && x.code === code);
  if (s) return `${keyName(code)} is the ${s.label.replace(/ \(.*\)$/, '')} shortcut`;
  return null;
}

/**
 * Gives an action a new key. A key the same half already uses swaps with it; a key the other half uses, or a
 * reserved one, is refused with the reason.
 */
export function rebind(b: Record<Half, Bindings>, half: Half, action: Action, code: string): Record<Half, Bindings> | string {
  const why = reservedKey(code);
  if (why) return why;
  const other: Half = half === 'left' ? 'right' : 'left';
  const theirs = ACTIONS.find((a) => b[other][a] === code);
  if (theirs) return `${keyName(code)} is the ${half === 'left' ? 'right' : 'left'}-hand ${ACTION_LABELS[theirs].toLowerCase()} key`;
  const mine = { ...b[half] };
  const clash = ACTIONS.find((a) => a !== action && mine[a] === code);
  if (clash) mine[clash] = mine[action];
  mine[action] = code;
  return { ...b, [half]: mine } as Record<Half, Bindings>;
}

/** Online extras. None of them is a key either half of the keyboard plays with (keys.test.ts checks). */
export const ONLINE_KEYS = {
  /** Opens the chat line. */
  chat: 'KeyT',
  /** Held: the scoreboard. In the chat line: the next (Shift: previous) recipient. */
  scoreboard: 'Tab',
  /** A spectator, or a player whose base is out, follows player 1-4. */
  follow: ['Digit1', 'Digit2', 'Digit3', 'Digit4'],
} as const;

/**
 * Moving through the on-screen menus (menu.ts). While a menu is open it has the keyboard, as a dialog does, and the
 * match takes no keys; so these may be play keys. Enter and Space press the focused button, as anywhere on a page.
 */
export const MENU_KEYS = {
  prev: ['ArrowUp'],
  next: ['ArrowDown'],
  /** Opens the focused sub-menu. */
  open: ['ArrowRight'],
  /** Back to the menu before. */
  back: ['ArrowLeft'],
  /** Back to the menu before, or from the first one, closes the menu. */
  close: ['Escape'],
} as const;

/**
 * Watching a replay (replay.ts in packages/net, the player in game.ts). Nobody drives then, so these may be play
 * keys; P pauses as in any offline match.
 */
export const REPLAY_KEYS = {
  slower: ['Minus', 'NumpadSubtract'],
  faster: ['Equal', 'NumpadAdd'],
  /** Ten seconds back or on. */
  back: ['Comma'],
  forward: ['Period'],
  /** Follow player 1-4. */
  follow: ['Digit1', 'Digit2', 'Digit3', 'Digit4'],
} as const;

export type ShortcutId = 'help' | 'newGame' | 'pause' | 'fullScreen' | 'restart' | 'hallOfFame' | 'menus' | 'swapSides' | 'mute' | 'thermal';

export interface Shortcut {
  id: ShortcutId;
  code: string;
  /** Held with Alt, which the controls never read: for the shortcuts that would lose a match to a stray key. */
  alt?: true;
  label: string;
}

/**
 * The game's shortcuts (main.ts). No function keys: laptops hide them behind Fn and browsers keep several (F1 help,
 * F3 find, F5 reload). The plain ones are letters neither half of the keyboard plays with, nor the chat key.
 */
export const SHORTCUTS: Shortcut[] = [
  { id: 'help', code: 'KeyH', label: 'Help Topics' },
  { id: 'pause', code: 'KeyP', label: 'Pause / Resume (not online)' },
  { id: 'newGame', code: 'KeyN', label: 'New Game' },
  { id: 'hallOfFame', code: 'KeyL', label: 'Hall of Fame' },
  { id: 'menus', code: 'KeyM', label: 'Open the menu' },
  { id: 'mute', code: 'KeyV', label: 'Sound off / on' },
  { id: 'thermal', code: 'KeyI', label: 'Thermal camera on / off (modern)' },
  { id: 'restart', code: 'KeyR', alt: true, label: 'Restart' },
  { id: 'fullScreen', code: 'Enter', alt: true, label: 'Full Screen' },
  { id: 'swapSides', code: 'Digit3', alt: true, label: 'Swap Sides' },
];

/** A shortcut as the menus and Help show it: H, Alt+R. */
export function shortcutName(id: ShortcutId): string {
  const s = SHORTCUTS.find((x) => x.id === id)!;
  return `${s.alt ? 'Alt+' : ''}${keyName(s.code)}`;
}

/** The shortcut a key press asks for. Ctrl and the system key belong to the browser (Ctrl+N, Ctrl+P, Ctrl+L...). */
export function shortcutFor(e: KeyboardEvent): ShortcutId | null {
  if (e.ctrlKey || e.metaKey) return null;
  return SHORTCUTS.find((s) => s.code === e.code && !!s.alt === e.altKey)?.id ?? null;
}

/** Every key either half of the keyboard plays with now. */
export function playKeys(): Set<string> {
  return new Set([...Object.values(bound.left), ...Object.values(bound.right)]);
}

const NAMES: Record<string, string> = {
  Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', Enter: 'Enter', Backspace: 'Backspace', Slash: '/',
  BracketLeft: '[', BracketRight: ']', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Tab: 'Tab', Escape: 'Esc',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Backquote: '`', Backslash: '\\', Minus: '-', Equal: '=', IntlBackslash: '\\',
  ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
};

/** A key code as the keyboard labels it: KeyW → W, Digit1 → 1, Slash → /, Numpad8 → Num 8. */
export function keyName(code: string): string {
  return NAMES[code] ?? code.replace(/^(Key|Digit)/, '').replace(/^Numpad/, 'Num ');
}

/** The rows Help Topics lists for each half of the keyboard: what it does, its keys, and how to join their names. */
export const CONTROL_ROWS: [string, (c: Controls) => string[], string][] = [
  ['Drive (forward, back, turn)', (c) => [c.up, c.down, c.left, c.right].map((k) => k[0]!), ' '],
  ['Fire', (c) => c.fire, ''],
  ['Second button', (c) => c.fire2, ''],
  ['Third button', (c) => c.fire3, ''],
  ['Tank turret left / right', (c) => [...c.turretLeft, ...c.turretRight], ' / '],
  ['Launch jeep, tank, ASV, helicopter', (c) => c.launch.map((k) => k[0]!), ' '],
  ['Back into the bunker (on your base)', (c) => c.dock, ''],
];

/**
 * True when a key belongs to a text box, a list or a slider rather than the game: typing a name, a chat line or a
 * map search must never drive a vehicle or fire a shortcut.
 */
export function typingIn(e: Event): boolean {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  return t instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(t.type);
}
