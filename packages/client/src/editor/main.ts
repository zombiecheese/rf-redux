// The level editor page (/editor.html), for desktop browsers only: a bar along the top with the menus, the map's
// name and save state, undo and redo, the preview switch (Classic, Modern or Night: the game's own renderers draw
// the map as it is edited) and the camera, and Test Play; tools down the left; the map in the middle with the
// minimap, zoom buttons and a read-out of the tile under the pointer; the palette, map settings and problem list
// on the right. It is dressed like the game's menus (ui.css). Maps are saved as drafts in this browser and can be
// exported as .rfw.json files, test played against bots, and opened again later.

import {
  MAX_BASES, ShorePainter, checkMap, decodeTerrain, newMap, parseMap, type Ground, type MapPoint, type MapProblem, type RfwMap, type Transform,
} from '@rfw/sim';
import { loadCommon, loadMap, loadMapIndex, type GameData } from '../assets.js';
import { isHandheld } from '../display.js';
import { Menubar, dialog, dialogOpen, el, field, modernUi, notice } from '../dialogs.js';
import '../ui.css';
import { BASE_CSS, MapView, Minimap, dot, type Look, type Overlay, type ViewMode } from './canvas.js';
import { EditorDoc } from './doc.js';
import { settingsPanel } from './settings.js';
import { browseLibrary, saveToLibrary } from './library.js';
import { deleteDraft, lastOpen, listDrafts, loadDraft, newDraftId, saveDraft, setLastOpen } from './storage.js';
import { testPlay } from './testplay.js';
import { CheatSheet, Checklist, KEY_SECTIONS, fixFor, keyTable, markTested } from './guide.js';
import { MapPreview } from '../mappreview.js';
import { TEAMS } from '../paint.js';
import { buildingIcon, palette, tileColours, tileIcon, tileTransforms, type PaletteEntry } from './tiles.js';
import {
  GROUNDS, SYMMETRIES, copy, line, mirrorMap, paintTiles, paste, placeBridge, placeObjects, placeStart, rect, region, setTiles, square,
  toggleFlag, transformClip, type Clip, type Symmetry, type ToolContext,
} from './tools.js';
import './editor.css';

type ToolId = 'select' | 'land' | 'shallow' | 'deep' | 'tile' | 'bridge' | 'object' | 'erase' | 'start' | 'flag' | 'note' | 'pan';
type Shape = 'brush' | 'line' | 'rect' | 'fill';
type ToolGroup = 'Terrain' | 'Objects' | 'Bases' | 'Arrange';

/** Line icons for the tools, 20 x 20, drawn in the text colour. */
const ICONS: Record<ToolId | Shape, string> = {
  select: '<rect x="3.5" y="3.5" width="13" height="13" rx="1" stroke-dasharray="3 2"/>',
  land: '<path d="M2 16l5-8 3 4 2-3 6 7z"/>',
  shallow: '<path d="M2 8c2-2 4 2 6 0s4 2 6 0 3 1 4 0M2 13c2-2 4 2 6 0s4 2 6 0 3 1 4 0"/>',
  deep: '<path d="M2 6c2-2 4 2 6 0s4 2 6 0 3 1 4 0M2 10.5c2-2 4 2 6 0s4 2 6 0 3 1 4 0M2 15c2-2 4 2 6 0s4 2 6 0 3 1 4 0"/>',
  tile: '<rect x="3" y="3" width="14" height="14" rx="1"/><path d="M10 3v14M3 10h14"/>',
  bridge: '<path d="M2 8h16M2 12h16M5 8v4M10 8v4M15 8v4"/>',
  object: '<path d="M4 17V8l6-4 6 4v9zM8 17v-5h4v5"/>',
  erase: '<path d="M8 17l-5-5 8-8 6 6-7 7zM6 9l6 6M8 17h9"/>',
  start: '<rect x="3.5" y="3.5" width="13" height="13" rx="2"/><path d="M10 14V7M7 10l3-3 3 3"/>',
  flag: '<path d="M5 18V3M5 4h10l-3 3.5 3 3.5H5"/>',
  note: '<path d="M4 3h9l3 3v11H4zM7 8h6M7 11h6M7 14h4"/>',
  pan: '<path d="M10 2v16M2 10h16M10 2l-2 2M10 2l2 2M10 18l-2-2M10 18l2-2M2 10l2-2M2 10l2 2M18 10l-2-2M18 10l-2 2"/>',
  brush: '<circle cx="10" cy="10" r="5"/>',
  line: '<path d="M4 16L16 4"/>',
  rect: '<rect x="4" y="5" width="12" height="10" rx="1"/>',
  fill: '<path d="M4 10l6-6 6 6-6 6zM16 13c1 1.5 1.5 2.4 1.5 3a1.5 1.5 0 0 1-3 0c0-.6.5-1.5 1.5-3z"/>',
};

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg class="ico" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return wrap.firstElementChild as SVGSVGElement;
}

/** The preview switch: the game's two views, and the modern one at night (night is a match option of the modern view). */
const LOOKS: { id: Look; label: string; hint: string }[] = [
  { id: 'classic', label: 'Classic', hint: 'The classic pixel view, through its CRT' },
  { id: 'modern', label: 'Modern', hint: 'The modern 3D view, as the drone\'s feed, by day' },
  { id: 'night', label: 'Night', hint: 'The modern 3D view in a night match' },
];
const CAMERAS: { id: ViewMode; label: string; hint: string }[] = [
  { id: 'top', label: 'Top down', hint: 'Look straight down, best for laying out' },
  { id: 'tilted', label: 'Game camera', hint: 'The game\'s own tilted camera, as players see the map' },
];
/** The editor's own choices kept in this browser: the preview and the camera. */
const VIEW_KEY = 'rfw-editor-view';
/** Below this the editor's panels do not fit round a usable map. */
const MIN_W = 1000;
const MIN_H = 560;
/** After this long without the mouse or keyboard, the modern preview animates slowly. */
const IDLE_MS = 5000;

/** A building's name as the palette shows it: TOWER_LARGE becomes Tower large, BLDG_N becomes Bldg (N), its facing. */
function pretty(name: string): string {
  const t = name.replace(/_([NSEWHV])$/, ' ($1)').replace(/_/g, ' ').toLowerCase().replace(/\(([nsewhv])\)$/, (_, f: string) => `(${f.toUpperCase()})`);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const TOOLS: { id: ToolId; label: string; key: string; hint: string; group: ToolGroup; shapes?: boolean }[] = [
  { id: 'select', label: 'Select', key: 'S', hint: 'Drag a box to copy, cut, turn or mirror it', group: 'Arrange' },
  { id: 'land', label: 'Land', key: 'L', hint: 'Paint land; the coast follows', group: 'Terrain', shapes: true },
  { id: 'shallow', label: 'Shallows', key: 'W', hint: 'Paint shallow water (vehicles can drive through it)', group: 'Terrain', shapes: true },
  { id: 'deep', label: 'Deep water', key: 'D', hint: 'Paint deep water (vehicles sink)', group: 'Terrain', shapes: true },
  { id: 'tile', label: 'Tile', key: 'T', hint: 'Lay one terrain tile exactly, with no coast fixing', group: 'Terrain', shapes: true },
  { id: 'bridge', label: 'Bridge', key: 'R', hint: 'Drag across water along a row or column', group: 'Terrain' },
  { id: 'object', label: 'Building', key: 'B', hint: 'Place buildings and scenery', group: 'Objects', shapes: true },
  { id: 'erase', label: 'Erase', key: 'E', hint: 'Remove buildings and scenery', group: 'Objects', shapes: true },
  { id: 'start', label: 'Base start', key: 'A', hint: 'Place a base\'s lift, where its vehicles come up', group: 'Bases' },
  { id: 'flag', label: 'Flag site', key: 'F', hint: 'Add or remove a building the base\'s flag can hide in', group: 'Bases' },
  { id: 'note', label: 'Note', key: 'N', hint: 'Pin a note to a tile (only editors see it)', group: 'Arrange' },
  { id: 'pan', label: 'Move view', key: 'H', hint: 'Drag to move around (or drag with the right button anywhere)', group: 'Arrange' },
];
const SHAPES: { id: Shape; label: string }[] = [
  { id: 'brush', label: 'Brush' }, { id: 'line', label: 'Line' }, { id: 'rect', label: 'Box' }, { id: 'fill', label: 'Fill' },
];

async function boot(): Promise<void> {
  // Phones and tablets have no level editor (the game's menu leaves it out): a mouse and a keyboard are needed.
  if (isHandheld()) {
    document.getElementById('desktop-only')!.hidden = false;
    return;
  }
  modernUi();
  document.body.classList.add('ui');
  const status = document.getElementById('status')!;
  status.textContent = 'Loading the game data…';
  const data = await loadCommon();
  const lift = await liftTerrain();
  status.remove();
  // Kept on the page for the browser console and automated checks.
  (window as unknown as { rfwEditor: Editor }).rfwEditor = new Editor(data, lift);
}

/**
 * The terrain under a base's start in the original maps (the lift pad), for each side, read from the first converted
 * map. Without the maps, starts keep whatever terrain they are put on.
 */
async function liftTerrain(): Promise<number[] | null> {
  try {
    const first = (await loadMapIndex())[0];
    if (!first) return null;
    const map = await loadMap(first.id);
    const t = decodeTerrain(map.terrain);
    return map.bases.map((b) => t[b.start.y * map.width + b.start.x]!);
  } catch {
    return null;
  }
}

class Editor {
  doc: EditorDoc;
  draftId: string;
  private readonly painter: ShorePainter;
  private readonly turned: Record<Transform, Uint8Array>;
  private readonly names: ReadonlySet<string>;
  private readonly entries: PaletteEntry[];
  readonly view: MapView;
  private readonly minimap: Minimap;
  private tool: ToolId = 'land';
  private shape: Shape = 'brush';
  private size = 1;
  private symmetry: Symmetry = 'none';
  private land = 3;
  private terrain = 3;
  private objectType: string | null = null;
  private owner: number | null = null;
  private base = 0;
  private grid = true;
  private problems: MapProblem[] = [];
  private focus: MapProblem | null = null;
  private selection: { a: MapPoint; b: MapPoint } | null = null;
  private clip: Clip | null = null;
  private floating = false;
  private cursor: MapPoint | null = null;
  private drag: { start: MapPoint; last: MapPoint; changed: boolean } | null = null;
  private panning: { x: number; y: number } | null = null;
  private spaceHeld = false;
  private needsDraw = true;
  private checkedFor = -1;
  private savedFor = -1;
  private readonly side = el('div', { class: 'side-body' });
  private readonly statusbar = el('div', { class: 'statusbar' });
  private readonly toolbar = el('aside', { class: 'ed-rail' });
  private readonly tabs = el('div', { class: 'tabs' });
  private readonly docName = el('span', { class: 'ed-doc-name' });
  private readonly saveChip = el('span', { class: 'ed-chip' });
  private readonly lookSwitch = el('div', { class: 'ed-seg', role: 'radiogroup', ariaLabel: 'Preview' } as Partial<HTMLElement>);
  private readonly cameraSwitch = el('div', { class: 'ed-seg', role: 'radiogroup', ariaLabel: 'Camera' } as Partial<HTMLElement>);
  private readonly undoBtn = el('button', { type: 'button', class: 'ed-icon', title: 'Undo (Ctrl+Z)', ariaLabel: 'Undo' }, '↶');
  private readonly redoBtn = el('button', { type: 'button', class: 'ed-icon', title: 'Redo (Ctrl+Y)', ariaLabel: 'Redo' }, '↷');
  private readonly loadingPill = el('div', { class: 'ed-pill ed-loading', hidden: true }, 'Loading the modern view…');
  private readonly tooSmall = el('div', { class: 'ed-too-small', hidden: true },
    el('b', {}, 'Make the window bigger'), el('span', {}, `The level editor needs a window at least ${MIN_W} × ${MIN_H} pixels for its tools and the map.`));
  private tab: 'palette' | 'settings' | 'problems' = 'palette';
  private testing = false;
  /** When the pointer or a key last did something, for slowing the modern view's animation when idle. */
  private lastInput = performance.now();
  private lastAnimated = 0;
  private readonly cheat = new CheatSheet();
  private readonly guide = new Checklist((step) => this.guideStep(step));
  private readonly moonBtn = el('button', { type: 'button', class: 'ed-pill ed-moon', title: 'Extra light in the Night preview so the whole map can be read. Test Play and matches stay as dark as a real night.' });

  constructor(private readonly data: GameData, private readonly lift: number[] | null) {
    this.painter = new ShorePainter(data.shore);
    this.turned = tileTransforms(data, this.painter);
    this.names = new Set(data.defs.map((d) => d.name));
    this.entries = palette(data);
    this.objectType = this.entries[0]?.def.name ?? null;

    const last = lastOpen();
    const draft = last ? loadDraft(last) : null;
    this.draftId = draft && last ? last : newDraftId();
    this.doc = new EditorDoc(draft ?? newMap({ name: 'Untitled', width: 64, height: 64 }));
    this.savedFor = this.doc.version;
    setLastOpen(this.draftId);

    this.view = new MapView(data, () => this.doc);
    this.view.onLoad = () => {
      this.syncToolbar();
      this.redraw();
    };
    this.minimap = new Minimap(tileColours(data), () => this.doc);
    try {
      const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as { look?: Look; mode?: ViewMode; moonlight?: boolean };
      if (saved.moonlight === false) this.view.moonlight = false;
      if (saved.mode === 'top' || saved.mode === 'tilted') this.view.mode = saved.mode;
      if (saved.look && LOOKS.some((l) => l.id === saved.look)) this.view.setLook(saved.look);
    } catch {
      // The defaults: classic, top down.
    }
    this.layout();
    requestAnimationFrame(() => {
      this.view.fit();
      this.redraw();
    });
    const loop = () => {
      this.frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    setInterval(() => this.autosave(), 1500);
    for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const) {
      addEventListener(type, () => (this.lastInput = performance.now()), { capture: true, passive: true });
    }
    addEventListener('beforeunload', () => this.autosave());
  }

  private get ctx(): ToolContext {
    return { doc: this.doc, painter: this.painter, turned: this.turned, names: this.names, symmetry: this.symmetry, land: this.land, lift: this.lift };
  }

  // ---- Layout ------------------------------------------------------------------------------------------------------

  private layout(): void {
    const menubar = new Menubar([
      {
        label: 'File', items: [
          { label: 'New Map...', key: 'Ctrl+Alt+N', action: () => void this.newDialog() },
          { label: 'Open...', key: 'Ctrl+O', action: () => void this.openDialog() },
          { label: 'Save Draft', key: 'Ctrl+S', action: () => this.save(true) },
          { label: 'Save as Copy', action: () => this.saveCopy() },
          { label: '-' },
          { label: 'Save to Library...', key: 'Ctrl+Shift+S', action: () => void this.saveToLibrary() },
          { label: 'Shared Maps...', key: 'Ctrl+Shift+O', action: () => void this.browse() },
          { label: '-' },
          { label: 'Import .rfw.json...', action: () => this.importFile() },
          { label: 'Export .rfw.json', key: 'Ctrl+E', action: () => this.exportFile() },
          { label: '-' },
          { label: 'Back to the Game', action: () => (location.href = './') },
        ],
      },
      {
        label: 'Edit', items: [
          { label: 'Undo', key: 'Ctrl+Z', action: () => this.undo(), enabled: () => this.doc.canUndo },
          { label: 'Redo', key: 'Ctrl+Y', action: () => this.redo(), enabled: () => this.doc.canRedo },
          { label: '-' },
          { label: 'Cut', key: 'Ctrl+X', action: () => this.cut(), enabled: () => !!this.selection },
          { label: 'Copy', key: 'Ctrl+C', action: () => this.copySelection(), enabled: () => !!this.selection },
          { label: 'Paste', key: 'Ctrl+V', action: () => this.startPaste(), enabled: () => !!this.clip },
          { label: 'Delete Buildings', key: 'Del', action: () => this.deleteSelection(), enabled: () => !!this.selection },
          { label: 'Select All', key: 'Ctrl+A', action: () => this.selectAll() },
          { label: '-' },
          { label: 'Mirror Selection ↔', action: () => this.transformSelection('flipX'), enabled: () => !!this.selection },
          { label: 'Mirror Selection ↕', action: () => this.transformSelection('flipY'), enabled: () => !!this.selection },
          { label: 'Turn Selection Right', action: () => this.transformSelection('turnRight'), enabled: () => !!this.selection },
        ],
      },
      {
        label: 'View', items: [
          ...LOOKS.map((l) => ({
            label: `Preview: ${l.label}`, key: 'V', action: () => this.setLook(l.id), checked: () => this.view.look === l.id,
            enabled: () => l.id === 'classic' || MapView.modernAvailable,
          })),
          { label: '-' },
          { label: 'Top Down', key: 'Tab', action: () => this.setMode('top'), checked: () => this.view.mode === 'top' },
          { label: 'Game Camera', key: 'Tab', action: () => this.setMode('tilted'), checked: () => this.view.mode === 'tilted' },
          { label: '-' },
          { label: 'Grid', key: 'G', action: () => this.toggleGrid(), checked: () => this.grid },
          { label: 'Zoom to Fit', key: '0', action: () => { this.view.fit(); this.redraw(); } },
          {
            label: 'Classic Pixel Size', items: [1, 2, 3].map((n) => ({
              label: `${n}×`, action: () => { this.view.pixel = n; this.redraw(); }, checked: () => this.view.pixel === n,
            })),
          },
        ],
      },
      {
        label: 'Map', items: [
          { label: 'Settings...', action: () => this.showTab('settings') },
          { label: 'Check for Problems', action: () => this.showTab('problems') },
          { label: 'Make Symmetric', action: () => this.makeSymmetric(), enabled: () => this.symmetry !== 'none' },
          { label: '-' },
          { label: 'Test Play...', key: 'P', action: () => void this.test() },
        ],
      },
      {
        label: 'Help', items: [
          { label: 'Map Editor Help', key: '?', action: () => void this.help() },
          { label: 'Key Cheat Sheet', key: 'Hold K', action: () => this.cheat.show() },
          { label: 'Getting Started', action: () => this.showGuide(), checked: () => !this.guide.off },
        ],
      },
    ]);
    menubar.root.className = 'editor-menubar';
    const testBtn = el('button', { type: 'button', class: 'btn default ed-test', title: 'Play the map against the computer (P)' }, '▶ Test Play');
    testBtn.addEventListener('click', () => void this.test());
    const back = el('a', { class: 'ed-back', href: './', title: 'Back to the game' }, '✕');
    this.undoBtn.addEventListener('click', () => this.undo());
    this.redoBtn.addEventListener('click', () => this.redo());
    const segment = (wrap: HTMLElement, items: { id: string; label: string; hint: string }[], key: string, pick: (id: string) => void) => {
      for (const it of items) {
        const b = el('button', { type: 'button', class: 'ed-seg-btn', title: `${it.hint} (${key})`, role: 'radio' } as Partial<HTMLButtonElement>, it.label);
        b.dataset.id = it.id;
        b.addEventListener('click', () => pick(it.id));
        wrap.append(b);
      }
    };
    segment(this.lookSwitch, LOOKS, 'V', (id) => this.setLook(id as Look));
    segment(this.cameraSwitch, CAMERAS, 'Tab', (id) => this.setMode(id as ViewMode));
    const header = el('header', { class: 'ed-top' },
      el('div', { class: 'ed-brand' }, el('b', {}, 'Map Editor'), el('span', {}, 'Return Fire: Redux')),
      menubar.root,
      el('div', { class: 'ed-doc' }, this.docName, this.saveChip),
      el('span', { class: 'spacer' }),
      el('div', { class: 'ed-group' }, this.undoBtn, this.redoBtn),
      el('div', { class: 'ed-labelled' }, el('span', {}, 'Preview'), this.lookSwitch),
      el('div', { class: 'ed-labelled' }, el('span', {}, 'Camera'), this.cameraSwitch),
      testBtn, back);

    for (const group of ['Terrain', 'Objects', 'Bases', 'Arrange'] as const) {
      this.toolbar.append(el('div', { class: 'ed-caption' }, group));
      for (const t of TOOLS.filter((x) => x.group === group)) {
        const b = el('button', { type: 'button', class: 'tool', title: `${t.hint} (${t.key})` }, icon(t.id), el('span', { class: 'tool-label' }, t.label), el('kbd', {}, t.key));
        b.dataset.tool = t.id;
        b.addEventListener('click', () => this.setTool(t.id));
        this.toolbar.append(b);
      }
    }
    this.toolbar.append(el('div', { class: 'ed-caption' }, 'Brush'));
    const shapes = el('div', { class: 'shapes' });
    for (const s of SHAPES) {
      const b = el('button', { type: 'button', class: 'shape', title: s.label, ariaLabel: s.label }, icon(s.id));
      b.dataset.shape = s.id;
      b.addEventListener('click', () => {
        this.shape = s.id;
        this.syncToolbar();
      });
      shapes.append(b);
    }
    const size = el('select', { title: 'Brush size' });
    for (const n of [1, 2, 3, 5, 7]) size.add(new Option(`${n} × ${n}`, String(n)));
    size.addEventListener('change', () => (this.size = Number(size.value)));
    const sym = el('select', { title: 'Symmetry' });
    for (const s of SYMMETRIES) sym.add(new Option(s.label, s.id));
    sym.addEventListener('change', () => {
      this.symmetry = sym.value as Symmetry;
      sym.title = SYMMETRIES.find((s) => s.id === this.symmetry)!.hint;
      this.redraw();
    });
    this.toolbar.append(shapes, el('label', { class: 'small' }, 'Size', size), el('label', { class: 'small' }, 'Symmetry', sym));

    const zoomBtn = (label: string, title: string, fn: () => void) => {
      const b = el('button', { type: 'button', class: 'ed-icon', title, ariaLabel: title }, label);
      b.addEventListener('click', () => {
        fn();
        this.redraw();
      });
      return b;
    };
    const zoom = el('div', { class: 'ed-zoom' },
      zoomBtn('+', 'Zoom in (+)', () => this.view.zoom(1.25)), zoomBtn('−', 'Zoom out (-)', () => this.view.zoom(0.8)),
      zoomBtn('⤢', 'Zoom to fit (0)', () => this.view.fit()));
    this.moonBtn.addEventListener('click', () => {
      this.view.moonlight = !this.view.moonlight;
      this.keepView();
      this.syncToolbar();
      this.redraw();
    });
    const stage = el('main', { class: 'stage' }, this.view.canvas, this.minimap.canvas, zoom, this.statusbar, this.loadingPill, this.moonBtn, this.guide.root);
    document.body.append(this.cheat.root);
    for (const [id, label] of [['palette', 'Palette'], ['settings', 'Map'], ['problems', 'Problems']] as const) {
      const b = el('button', { type: 'button', class: 'tab' }, label);
      b.dataset.tab = id;
      b.addEventListener('click', () => this.showTab(id));
      this.tabs.append(b);
    }
    const sidebar = el('aside', { class: 'sidebar' }, this.tabs, this.side);
    document.body.append(header, el('div', { class: 'editor' }, this.toolbar, stage, sidebar), this.tooSmall);
    document.body.classList.add('editor-page');
    const fits = () => (this.tooSmall.hidden = innerWidth >= MIN_W && innerHeight >= MIN_H);
    addEventListener('resize', fits);
    fits();

    this.bindCanvas();
    this.bindKeys();
    this.syncToolbar();
    this.renderSide();
    new ResizeObserver(() => this.redraw()).observe(this.view.canvas);
  }

  private syncToolbar(): void {
    this.toolbar.querySelectorAll<HTMLElement>('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === this.tool));
    const shaped = TOOLS.find((t) => t.id === this.tool)?.shapes ?? false;
    this.toolbar.querySelectorAll<HTMLButtonElement>('.shape').forEach((b) => {
      b.classList.toggle('on', b.dataset.shape === this.shape);
      b.disabled = !shaped;
    });
    this.tabs.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    const errors = this.problems.filter((p) => p.level === 'error').length;
    const warnings = this.problems.length - errors;
    const label = this.tabs.querySelector<HTMLElement>('[data-tab=problems]')!;
    label.replaceChildren('Problems', el('span', { class: 'count' }, errors ? String(errors) : warnings ? String(warnings) : '✓'));
    label.classList.toggle('bad', errors > 0);
    label.classList.toggle('warn', !errors && warnings > 0);
    label.classList.toggle('good', !errors && !warnings);
    const look = this.view.look;
    this.lookSwitch.querySelectorAll<HTMLButtonElement>('.ed-seg-btn').forEach((b) => {
      b.classList.toggle('on', b.dataset.id === look);
      b.setAttribute('aria-checked', String(b.dataset.id === look));
      if (b.dataset.id !== 'classic' && !MapView.modernAvailable) {
        b.disabled = true;
        b.title = 'The modern view needs WebGL, which this browser does not have';
      }
    });
    this.cameraSwitch.querySelectorAll<HTMLButtonElement>('.ed-seg-btn').forEach((b) => {
      b.classList.toggle('on', b.dataset.id === this.view.mode);
      b.setAttribute('aria-checked', String(b.dataset.id === this.view.mode));
    });
    this.loadingPill.hidden = !this.view.loading;
    this.moonBtn.hidden = this.view.shownLook !== 'night';
    this.moonBtn.textContent = `☾ Moonlight ${this.view.moonlight ? 'on' : 'off'}`;
    this.moonBtn.classList.toggle('on', this.view.moonlight);
    this.undoBtn.disabled = !this.doc.canUndo;
    this.redoBtn.disabled = !this.doc.canRedo;
    document.body.dataset.look = this.view.shownLook;
  }

  private setTool(t: ToolId): void {
    this.tool = t;
    this.floating = false;
    if (t !== 'select') this.selection = null;
    if (this.tab !== 'palette') this.tab = 'palette';
    this.syncToolbar();
    this.renderSide();
    this.redraw();
  }

  private showTab(t: 'palette' | 'settings' | 'problems'): void {
    this.tab = t;
    this.syncToolbar();
    this.renderSide();
  }

  private renderSide(): void {
    this.side.replaceChildren();
    if (this.tab === 'settings') {
      this.side.append(settingsPanel(this.doc, (fn) => this.edit(fn), () => this.renderSide()));
      return;
    }
    if (this.tab === 'problems') {
      this.side.append(this.problemList());
      return;
    }
    const hint = TOOLS.find((t) => t.id === this.tool)!.hint;
    this.side.append(el('p', { class: 'hint' }, hint));
    if (this.tool === 'land') this.side.append(this.tilePicker((t) => this.painter.pure(t) === 0, () => this.land, (t) => (this.land = t)));
    if (this.tool === 'tile') this.side.append(this.tilePicker(() => true, () => this.terrain, (t) => (this.terrain = t)));
    if (this.tool === 'object') this.side.append(this.objectPicker());
    if (this.tool === 'start' || this.tool === 'flag') this.side.append(this.basePicker());
    if (this.tool === 'select') {
      this.side.append(el('p', { class: 'hint' }, 'Ctrl+C copies, Ctrl+X cuts, Ctrl+V pastes. While pasting, R turns and H or V mirror what you hold; click to put it down.'));
    }
    if (this.tool === 'bridge') {
      this.side.append(el('p', { class: 'hint' }, 'The game lays the deck between the two end pieces when the map loads. Both ends must be in the same row or column.'));
    }
  }

  private tilePicker(show: (t: number) => boolean, get: () => number, set: (t: number) => void): HTMLElement {
    const grid = el('div', { class: 'tiles' });
    for (let t = 0; t < 128; t++) {
      if (!this.data.cel(t) || !show(t)) continue;
      const b = el('button', { type: 'button', class: 'pick', title: `Terrain ${t}` }, tileIcon(this.data, t));
      b.classList.toggle('on', get() === t);
      b.addEventListener('click', () => {
        set(t);
        grid.querySelectorAll('.pick').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      });
      grid.append(b);
    }
    return grid;
  }

  private objectPicker(): HTMLElement {
    const wrap = el('div', { class: 'stack' });
    const owner = el('select', {});
    owner.add(new Option('Neutral', ''));
    for (let b = 0; b < MAX_BASES; b++) owner.add(new Option(`Base ${b + 1} (${TEAMS[b]!.name})`, String(b)));
    owner.value = this.owner === null ? '' : String(this.owner);
    owner.addEventListener('change', () => {
      this.owner = owner.value === '' ? null : Number(owner.value);
      this.renderSide();
    });
    wrap.append(field('Owner:', owner));
    const colours = this.owner ?? -1;
    const assets = { ...this.data, map: this.doc.toMap() };
    for (const group of ['Buildings', 'Defences', 'Scenery'] as const) {
      const list = this.entries.filter((e) => e.group === group);
      if (!list.length) continue;
      const grid = el('div', { class: 'objects' });
      for (const e of list) {
        const b = el('button', { type: 'button', class: 'pick', title: pretty(e.def.name) }, buildingIcon(assets, e.def.id, e.owned ? colours : -1), el('span', {}, pretty(e.def.name)));
        b.classList.toggle('on', this.objectType === e.def.name);
        b.addEventListener('click', () => {
          this.objectType = e.def.name;
          // Scenery is usually neutral and base buildings owned; switching kinds picks the usual owner.
          if (!e.owned) this.owner = null;
          else if (this.owner === null) this.owner = this.base < MAX_BASES ? Math.min(this.base, 3) : 0;
          this.renderSide();
        });
        grid.append(b);
      }
      wrap.append(el('fieldset', {}, el('legend', {}, group), grid));
    }
    return wrap;
  }

  private basePicker(): HTMLElement {
    const wrap = el('div', { class: 'stack' });
    const count = this.doc.bases.length;
    for (let b = 0; b < Math.min(MAX_BASES, count + (this.tool === 'start' ? 1 : 0)); b++) {
      const base = this.doc.bases[b];
      const text = base ? `Base ${b + 1}: lift at ${base.start.x}, ${base.start.y}; ${base.flagSites.length} flag site${base.flagSites.length === 1 ? '' : 's'}` : `New base ${b + 1}`;
      const r = el('label', { class: 'radio base' }, el('input', { type: 'radio', name: 'base', checked: this.base === b }), dot(BASE_CSS[b]!), text);
      r.querySelector('input')!.addEventListener('change', () => (this.base = b));
      wrap.append(r);
    }
    if (count) {
      const rm = el('button', { type: 'button', class: 'btn' }, `Remove base ${Math.min(this.base, count - 1) + 1}`);
      rm.addEventListener('click', () => {
        this.edit(() => {
          this.doc.removeBase(Math.min(this.base, count - 1));
          return true;
        });
        this.base = 0;
        this.renderSide();
      });
      wrap.append(rm);
    }
    wrap.append(el('p', { class: 'hint' }, `Up to ${MAX_BASES} bases. Each one is a player slot; the computer plays any nobody takes. With symmetry on, placing base 1 places its mirror bases too.`));
    return wrap;
  }

  private problemList(): HTMLElement {
    const wrap = el('div', { class: 'stack' });
    if (!this.problems.length) {
      wrap.append(el('p', {}, 'No problems found. The map can be test played and shared.'));
      return wrap;
    }
    wrap.append(el('p', { class: 'hint' }, 'Click a problem to go to it, or press J for the next one (Shift+J the one before).'));
    for (const p of this.problems) {
      const b = el('button', { type: 'button', class: `problem ${p.level}` + (p === this.focus ? ' on' : '') }, el('b', {}, p.level === 'error' ? 'Error' : 'Warning'), ' ', p.message);
      b.addEventListener('click', () => this.goTo(p));
      const fix = fixFor(p, this.doc, { ...this.ctx, symmetry: 'none' });
      if (!fix) {
        wrap.append(b);
        continue;
      }
      const f = el('button', { type: 'button', class: 'btn small fix' }, `✓ ${fix.label}`);
      f.addEventListener('click', () => {
        if ('edit' in fix) {
          this.edit(fix.edit);
          this.flash(fix.label);
        } else {
          this.setTool(fix.tool);
          this.base = fix.base;
          this.renderSide();
          if (p.tiles[0]) this.view.centreOn(p.tiles[0]);
          this.redraw();
        }
      });
      wrap.append(el('div', { class: 'problem-row' }, b, f));
    }
    return wrap;
  }

  /** Centres the view on a problem and lights it up. */
  private goTo(p: MapProblem): void {
    this.focus = p;
    if (p.tiles[0]) this.view.centreOn(p.tiles[0]);
    if (this.tab === 'problems') this.renderSide();
    this.redraw();
  }

  /** J: the next problem (by: -1 the one before), from the Problems tab or anywhere. */
  private nextProblem(by: 1 | -1): void {
    const list = this.problems;
    if (!list.length) {
      this.flash('No problems: the map can be played');
      return;
    }
    const k = this.focus ? list.indexOf(this.focus) : -1;
    const p = list[(k + by + list.length) % list.length]!;
    this.goTo(p);
    this.flash(`${list.indexOf(p) + 1} of ${list.length}: ${p.message}`);
  }

  // ---- Getting started -------------------------------------------------------------------------------------------

  private refreshGuide(): void {
    let land = 0;
    const t = this.doc.terrain;
    for (let i = 0; i < t.length && !land; i++) if (this.painter.pure(t[i]! & 127) === GROUNDS.land) land++;
    this.guide.update(this.doc, this.problems, this.draftId, land);
  }

  private showGuide(): void {
    this.guide.turnOn();
    this.refreshGuide();
    if (this.guide.root.hidden) this.flash('Every step is done: the map is ready to play and share');
  }

  /** A click on a checklist step picks the tool that does it. */
  private guideStep(step: string): void {
    if (step === 'land') this.setTool('land');
    else if (step === 'start') {
      this.base = Math.min(this.doc.bases.length, MAX_BASES - 1);
      this.setTool('start');
    } else if (step === 'flag') {
      this.base = Math.max(0, this.doc.bases.findIndex((b) => !b.flagSites.length));
      this.setTool('flag');
    } else if (step === 'problems') {
      this.showTab('problems');
      if (this.problems[0]) this.goTo(this.problems[0]);
    } else if (step === 'test') void this.test();
  }

  // ---- Changes, drawing and saving -----------------------------------------------------------------------------------

  /** Runs an edit as one undo step; fn returns whether it changed anything. */
  private edit(fn: () => boolean): void {
    this.doc.checkpoint();
    if (fn()) this.changed();
    else this.doc.dropCheckpoint();
  }

  private changed(): void {
    this.doc.touch();
    this.redraw();
  }

  redraw(): void {
    this.needsDraw = true;
  }

  private frame(): void {
    if (this.checkedFor !== this.doc.version && !this.drag) {
      this.checkedFor = this.doc.version;
      this.problems = checkMap(this.doc.toMap(), this.data.defs, this.data.shore);
      if (this.focus && !this.problems.some((p) => p.code === this.focus!.code)) this.focus = null;
      this.syncToolbar();
      if (this.tab === 'problems') this.renderSide();
      this.refreshGuide();
      this.needsDraw = true;
    }
    if (this.testing) return;
    // The modern view animates (the sea, the feed's grain), but only needs every frame while someone is working:
    // a few frames a second once the editor has sat idle, and one a second while the window is in the background.
    const now = performance.now();
    const gap = !document.hasFocus() ? 1000 : now - this.lastInput > IDLE_MS ? 250 : 0;
    const animate = this.view.animated && now - this.lastAnimated >= gap;
    if (!this.needsDraw && !animate) {
      if (this.minimap.waiting && !this.drag) this.minimap.render(this.view);
      return;
    }
    this.needsDraw = false;
    this.lastAnimated = now;
    this.view.render(this.overlay());
    this.minimap.render(this.view, !!this.drag);
    this.updateStatus();
  }

  private overlay(): Overlay {
    let preview: MapPoint[] = [];
    let colour = 'rgba(255,255,255,0.25)';
    const c = this.cursor;
    if (this.floating && this.clip && c) {
      preview = rect({ x: c.x, y: c.y }, { x: c.x + this.clip.w - 1, y: c.y + this.clip.h - 1 });
      colour = 'rgba(120,200,255,0.3)';
    } else if (this.drag && (this.shape === 'line' || this.shape === 'rect') && this.isShaped()) {
      preview = this.shape === 'line' ? line(this.drag.start, this.drag.last, this.size) : rect(this.drag.start, this.drag.last);
    } else if (this.drag && this.tool === 'bridge') {
      const { start: a, last: b } = this.drag;
      preview = a.x === b.x || a.y === b.y ? rect(a, b) : [a];
      colour = a.x === b.x || a.y === b.y ? 'rgba(200,150,80,0.45)' : 'rgba(255,60,60,0.4)';
    } else if (c && this.isShaped() && this.shape === 'brush') {
      preview = square(c, this.size);
    }
    if (this.tool === 'erase') colour = 'rgba(255,80,80,0.3)';
    return {
      preview, previewColour: colour, selection: this.selection, problems: this.problems, focus: this.focus, grid: this.grid,
      cursor: c,
    };
  }

  private isShaped(): boolean {
    return TOOLS.find((t) => t.id === this.tool)?.shapes ?? false;
  }

  private updateStatus(): void {
    const c = this.cursor;
    const parts: string[] = [];
    if (c && this.doc.inside(c.x, c.y)) {
      const i = this.doc.index(c.x, c.y);
      parts.push(`${c.x}, ${c.y}`, `terrain ${this.doc.terrain[i]}`);
      const o = this.doc.objects.get(i);
      if (o) parts.push(pretty(o.type) + (o.base === null ? '' : `, base ${o.base + 1}`));
      const s = this.doc.startAt(c.x, c.y);
      if (s >= 0) parts.push(`base ${s + 1} lift`);
      const f = this.doc.flagAt(c.x, c.y);
      if (f >= 0) parts.push(`base ${f + 1} flag site`);
    }
    parts.push(`${this.doc.width} × ${this.doc.height} tiles`, `zoom ${Math.round(this.view.scale * 100)}%`);
    const text = parts.join(' · ');
    if (this.statusbar.textContent !== text) this.statusbar.textContent = text;
    const name = this.doc.meta.name;
    if (this.docName.textContent !== name) {
      this.docName.textContent = name;
      document.title = `${name} · Return Fire: Redux Map Editor`;
    }
    const saved = this.doc.version === this.savedFor;
    const lib = this.doc.library ? ` · library ${this.doc.library.visibility}, r${this.doc.library.revision}` : '';
    const chip = (saved ? 'Saved in this browser' : 'Unsaved changes') + lib;
    if (this.saveChip.textContent !== chip) {
      this.saveChip.textContent = chip;
      this.saveChip.classList.toggle('dirty', !saved);
    }
    this.undoBtn.disabled = !this.doc.canUndo;
    this.redoBtn.disabled = !this.doc.canRedo;
  }

  private thumbnail(): string | undefined {
    try {
      // The map in the look being previewed, as the minimap shows it.
      const pic = this.view.snapshot(128);
      if (!pic) return undefined;
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(pic, 0, 0, 64, 64);
      return c.toDataURL('image/png');
    } catch {
      return undefined;
    }
  }

  private autosave(): void {
    if (this.doc.version === this.savedFor) return;
    this.save(false);
  }

  private save(tell: boolean): void {
    try {
      saveDraft(this.draftId, this.doc.toMap(), this.thumbnail());
      setLastOpen(this.draftId);
      this.savedFor = this.doc.version;
      this.redraw();
      if (tell) this.flash('Saved in this browser');
    } catch {
      void notice('Save', 'This browser has no room left to save drafts. Export the map as a file, or delete old drafts from File > Open.');
    }
  }

  private flash(text: string): void {
    const t = el('div', { class: 'toast' }, text);
    document.body.append(t);
    setTimeout(() => t.remove(), 1600);
  }

  private load(map: RfwMap, id: string): void {
    this.doc = new EditorDoc(map);
    this.draftId = id;
    this.savedFor = this.doc.version;
    this.checkedFor = -1;
    this.selection = null;
    this.floating = false;
    this.focus = null;
    this.base = 0;
    setLastOpen(id);
    this.view.fit();
    this.renderSide();
    this.redraw();
  }

  // ---- Canvas input --------------------------------------------------------------------------------------------------

  private bindCanvas(): void {
    const c = this.view.canvas;
    const pos = (e: PointerEvent | WheelEvent) => {
      const r = c.getBoundingClientRect();
      return { sx: e.clientX - r.left, sy: e.clientY - r.top };
    };
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      if (e.button !== 0 || this.spaceHeld || this.tool === 'pan') {
        this.panning = { x: e.clientX, y: e.clientY };
        return;
      }
      const { sx, sy } = pos(e);
      const t = this.view.tileAt(sx, sy);
      if (!t) return;
      if (e.altKey) return this.pick(t);
      this.down(t, e.shiftKey);
    });
    c.addEventListener('pointermove', (e) => {
      if (this.panning) {
        this.view.pan(e.clientX - this.panning.x, e.clientY - this.panning.y);
        this.panning = { x: e.clientX, y: e.clientY };
        this.redraw();
        return;
      }
      const { sx, sy } = pos(e);
      const t = this.view.tileAt(sx, sy);
      const moved = !this.cursor || !t || t.x !== this.cursor.x || t.y !== this.cursor.y;
      this.cursor = t;
      if (t && this.drag && moved) this.move(t);
      if (moved) this.redraw();
    });
    const up = () => {
      if (this.panning) {
        this.panning = null;
        return;
      }
      if (this.drag) this.up();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => {
      this.cursor = null;
      this.redraw();
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.view.zoom(Math.exp(-e.deltaY * 0.0015), pos(e));
      this.redraw();
    }, { passive: false });
    const mm = this.minimap.canvas;
    const jump = (e: PointerEvent) => {
      const r = mm.getBoundingClientRect();
      this.view.centreOn(this.minimap.tileAt(e.clientX - r.left, e.clientY - r.top));
      this.redraw();
    };
    mm.addEventListener('pointerdown', (e) => {
      mm.setPointerCapture(e.pointerId);
      jump(e);
    });
    mm.addEventListener('pointermove', (e) => {
      if (e.buttons) jump(e);
    });
  }

  /** Alt+click: take the tile or building under the cursor as the brush. */
  private pick(t: MapPoint): void {
    if (!this.doc.inside(t.x, t.y)) return;
    const i = this.doc.index(t.x, t.y);
    const o = this.doc.objects.get(i);
    if (o && this.tool !== 'tile' && this.tool !== 'land') {
      this.objectType = o.type;
      this.owner = o.base;
      this.tool = 'object';
    } else {
      const terrain = this.doc.terrain[i]! & 127;
      if (this.painter.pure(terrain) === 0 && this.tool === 'land') this.land = terrain;
      else {
        this.terrain = terrain;
        this.tool = 'tile';
      }
    }
    this.syncToolbar();
    this.renderSide();
  }

  private down(t: MapPoint, shift: boolean): void {
    if (this.floating && this.clip) {
      const clip = this.clip;
      this.edit(() => {
        paste(this.ctx, clip, t);
        return true;
      });
      if (!shift) this.floating = false;
      return;
    }
    switch (this.tool) {
      case 'select':
        this.selection = { a: t, b: t };
        this.drag = { start: t, last: t, changed: false };
        break;
      case 'start':
        this.edit(() => placeStart(this.ctx, t, Math.min(this.base, this.doc.bases.length)));
        this.base = Math.min(this.base, this.doc.bases.length - 1);
        this.renderSide();
        break;
      case 'flag':
        if (!this.doc.bases[this.base]) {
          void notice('Flag site', 'Place the base\'s start first (the Base start tool).');
          break;
        }
        this.edit(() => toggleFlag(this.ctx, t, this.base));
        this.renderSide();
        break;
      case 'note':
        void this.noteAt(t);
        break;
      case 'bridge':
        this.drag = { start: t, last: t, changed: false };
        break;
      default: {
        if (!this.isShaped()) break;
        if (this.shape === 'fill') {
          this.edit(() => this.apply(this.fillRegion(t)));
          break;
        }
        this.doc.checkpoint();
        this.drag = { start: t, last: t, changed: false };
        if (this.shape === 'brush') this.drag.changed = this.apply(square(t, this.size));
        if (this.drag.changed) this.changed();
      }
    }
    this.redraw();
  }

  private move(t: MapPoint): void {
    const d = this.drag!;
    if (this.tool === 'select') this.selection = { a: d.start, b: t };
    else if (this.isShaped() && this.shape === 'brush') {
      if (this.apply(line(d.last, t, this.size))) {
        d.changed = true;
        this.changed();
      }
    }
    d.last = t;
  }

  private up(): void {
    const d = this.drag!;
    this.drag = null;
    if (this.tool === 'select') {
      this.selection = { a: d.start, b: d.last };
    } else if (this.tool === 'bridge') {
      if (d.start.x !== d.last.x || d.start.y !== d.last.y) {
        this.edit(() => placeBridge(this.ctx, d.start, d.last));
      }
    } else if (this.isShaped()) {
      if (this.shape === 'line') d.changed = this.apply(line(d.start, d.last, this.size));
      else if (this.shape === 'rect') d.changed = this.apply(rect(d.start, d.last));
      if (d.changed) this.changed();
      else this.doc.dropCheckpoint();
    }
    this.checkedFor = -1;
    this.redraw();
  }

  /** Applies the current brush tool to tiles. */
  private apply(points: MapPoint[]): boolean {
    const ctx = this.ctx;
    switch (this.tool) {
      case 'land':
      case 'shallow':
      case 'deep':
        return paintTiles(ctx, points, GROUNDS[this.tool] as Ground);
      case 'tile':
        return setTiles(ctx, points, this.terrain);
      case 'object':
        return this.objectType ? placeObjects(ctx, points, this.objectType, this.owner) : false;
      case 'erase':
        return placeObjects(ctx, points, null, null);
      default:
        return false;
    }
  }

  /** The tiles a fill from t covers: the same ground (ground tools), the same tile, or the same building. */
  private fillRegion(t: MapPoint): MapPoint[] {
    const d = this.doc;
    if (!d.inside(t.x, t.y)) return [];
    const i0 = d.index(t.x, t.y);
    if (this.tool === 'erase') {
      const type = d.objects.get(i0)?.type;
      return region(d, t, (i) => d.objects.get(i)?.type === type);
    }
    if (this.tool === 'tile' || this.tool === 'object') return region(d, t, (i) => d.terrain[i] === d.terrain[i0]);
    const g = this.painter.pure(d.terrain[i0]!);
    return region(d, t, (i) => this.painter.pure(d.terrain[i]!) === g);
  }

  private async noteAt(t: MapPoint): Promise<void> {
    if (!this.doc.inside(t.x, t.y)) return;
    const k = this.doc.notes.findIndex((n) => n.x === t.x && n.y === t.y);
    const input = el('input', { type: 'text', value: k >= 0 ? this.doc.notes[k]!.text : '', maxLength: 500 });
    input.style.width = '30ch';
    const buttons: [string, string][] = [['OK', 'ok'], ['Cancel', 'cancel']];
    if (k >= 0) buttons.splice(1, 0, ['Delete', 'delete']);
    const r = await dialog(k >= 0 ? 'Edit Note' : 'New Note', el('div', {}, field('Note:', input)), buttons);
    if (!r) return;
    this.edit(() => {
      if (r === 'delete' || !input.value.trim()) {
        if (k >= 0) this.doc.notes.splice(k, 1);
        return k >= 0;
      }
      if (k >= 0) this.doc.notes[k]!.text = input.value.trim();
      else this.doc.notes.push({ x: t.x, y: t.y, text: input.value.trim() });
      return true;
    });
  }

  // ---- Keys and commands -------------------------------------------------------------------------------------------

  private bindKeys(): void {
    addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceHeld = false;
    });
    addEventListener('keydown', (e) => {
      if (this.testing || dialogOpen()) return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const handle = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (ctrl) {
        switch (e.code) {
          case 'KeyZ': return handle(() => (e.shiftKey ? this.redo() : this.undo()));
          case 'KeyY': return handle(() => this.redo());
          case 'KeyC': return handle(() => this.copySelection());
          case 'KeyX': return handle(() => this.cut());
          case 'KeyV': return handle(() => this.startPaste());
          case 'KeyA': return handle(() => this.selectAll());
          case 'KeyS': return handle(() => (e.shiftKey ? void this.saveToLibrary() : this.save(true)));
          case 'KeyO': return handle(() => (e.shiftKey ? void this.browse() : void this.openDialog()));
          case 'KeyE': return handle(() => this.exportFile());
          case 'KeyN': if (e.altKey) return handle(() => void this.newDialog());
        }
        return;
      }
      if (this.floating && this.clip) {
        const t: Transform | null = e.code === 'KeyR' ? 'turnRight' : e.code === 'KeyH' ? 'flipX' : e.code === 'KeyV' ? 'flipY' : null;
        if (t) return handle(() => {
          this.clip = transformClip(this.clip!, t, this.turned, this.names);
          this.redraw();
        });
        if (e.code === 'Escape') return handle(() => {
          this.floating = false;
          this.redraw();
        });
      }
      switch (e.code) {
        case 'Space':
          this.spaceHeld = true;
          return handle(() => {});
        case 'Tab': return handle(() => this.setMode(this.view.mode === 'top' ? 'tilted' : 'top'));
        case 'KeyV': return handle(() => this.setLook(LOOKS[(LOOKS.findIndex((l) => l.id === this.view.look) + 1) % LOOKS.length]!.id));
        case 'KeyG': return handle(() => this.toggleGrid());
        case 'Digit0': return handle(() => { this.view.fit(); this.redraw(); });
        case 'Equal': case 'NumpadAdd': return handle(() => { this.view.zoom(1.25); this.redraw(); });
        case 'Minus': case 'NumpadSubtract': return handle(() => { this.view.zoom(0.8); this.redraw(); });
        case 'ArrowLeft': return handle(() => { this.view.pan(64, 0); this.redraw(); });
        case 'ArrowRight': return handle(() => { this.view.pan(-64, 0); this.redraw(); });
        case 'ArrowUp': return handle(() => { this.view.pan(0, 64); this.redraw(); });
        case 'ArrowDown': return handle(() => { this.view.pan(0, -64); this.redraw(); });
        case 'Delete': case 'Backspace': return handle(() => this.deleteSelection());
        case 'Escape': return handle(() => { this.selection = null; this.redraw(); });
        case 'KeyP': return handle(() => void this.test());
        case 'KeyJ': return handle(() => this.nextProblem(e.shiftKey ? -1 : 1));
        case 'KeyK': return handle(() => {
          if (!e.repeat) this.cheat.show();
        });
        case 'Slash': if (e.shiftKey) return handle(() => void this.help());
          break;
      }
      const tool = TOOLS.find((t) => `Key${t.key}` === e.code);
      if (tool) handle(() => this.setTool(tool.id));
    });
  }

  private setMode(m: ViewMode): void {
    this.view.mode = m;
    this.keepView();
    this.syncToolbar();
    this.redraw();
  }

  /** Classic, Modern or Night: which of the game's renderers draws the map. */
  private setLook(look: Look): void {
    if (look !== 'classic' && !MapView.modernAvailable) return;
    this.view.setLook(look);
    this.keepView();
    this.syncToolbar();
    this.redraw();
  }

  private keepView(): void {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ look: this.view.look, mode: this.view.mode, moonlight: this.view.moonlight }));
    } catch {
      // Not remembered.
    }
  }

  private toggleGrid(): void {
    this.grid = !this.grid;
    this.redraw();
  }

  private undo(): void {
    if (this.doc.undo()) this.afterHistory();
  }

  private redo(): void {
    if (this.doc.redo()) this.afterHistory();
  }

  private afterHistory(): void {
    this.base = Math.max(0, Math.min(this.base, this.doc.bases.length - 1));
    this.renderSide();
    this.redraw();
  }

  private selectAll(): void {
    this.setTool('select');
    this.selection = { a: { x: 0, y: 0 }, b: { x: this.doc.width - 1, y: this.doc.height - 1 } };
    this.redraw();
  }

  private copySelection(): void {
    if (!this.selection) return;
    this.clip = copy(this.doc, this.selection.a, this.selection.b);
    this.flash(`Copied ${this.clip.w} × ${this.clip.h}`);
  }

  private cut(): void {
    if (!this.selection) return;
    this.copySelection();
    this.deleteSelection();
  }

  private deleteSelection(): void {
    if (!this.selection) return;
    const pts = rect(this.selection.a, this.selection.b);
    this.edit(() => placeObjects({ ...this.ctx, symmetry: 'none' }, pts, null, null));
  }

  private startPaste(): void {
    if (!this.clip) return;
    this.floating = true;
    this.flash('Click to paste · R turns · H / V mirror · Esc stops');
    this.redraw();
  }

  private transformSelection(t: Transform): void {
    if (!this.selection) return;
    const { a, b } = this.selection;
    const at = { x: Math.max(0, Math.min(a.x, b.x)), y: Math.max(0, Math.min(a.y, b.y)) };
    const clip = transformClip(copy(this.doc, a, b), t, this.turned, this.names);
    this.edit(() => {
      paste(this.ctx, clip, at);
      return true;
    });
    this.selection = { a: at, b: { x: at.x + clip.w - 1, y: at.y + clip.h - 1 } };
  }

  private makeSymmetric(): void {
    if (this.symmetry === 'none') return;
    this.edit(() => {
      mirrorMap(this.ctx);
      return true;
    });
    this.renderSide();
  }

  // ---- Files and drafts --------------------------------------------------------------------------------------------

  private async newDialog(): Promise<void> {
    const name = el('input', { type: 'text', value: 'Untitled', maxLength: 64 });
    const w = el('input', { type: 'number', value: '64', min: '8', max: '128' } as Partial<HTMLInputElement>);
    const h = el('input', { type: 'number', value: '64', min: '8', max: '128' } as Partial<HTMLInputElement>);
    const fill = el('select', {});
    fill.add(new Option('Land', '3'));
    fill.add(new Option('Shallow water', '1'));
    fill.add(new Option('Deep water', '2'));
    const r = await dialog('New Map', el('div', { class: 'stack' }, field('Name:', name), field('Width:', w), field('Height:', h), field('Start with:', fill)),
      [['Create', 'ok'], ['Cancel', 'cancel']]);
    if (!r) return;
    this.autosave();
    const clamp = (v: string) => Math.min(128, Math.max(8, Math.round(Number(v)) || 64));
    this.load(newMap({ name: name.value.trim() || 'Untitled', width: clamp(w.value), height: clamp(h.value), fill: Number(fill.value) }), newDraftId());
  }

  private async openDialog(): Promise<void> {
    this.autosave();
    const drafts = listDrafts();
    const list = el('div', { class: 'drafts' });
    let pick: (() => void) | null = null;
    const choose = (b: HTMLElement, fn: () => void) => {
      list.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      pick = fn;
    };
    const preview = new MapPreview(() => Promise.resolve(this.data));
    preview.clear('Pick a map to see it');
    for (const d of drafts) {
      const img = el('img', { src: d.thumb ?? '', alt: '' });
      const b = el('button', { type: 'button', class: 'draft' }, img,
        el('span', {}, el('b', {}, d.name), el('br'), `${d.width} × ${d.height}, ${d.bases} base${d.bases === 1 ? '' : 's'} · ${new Date(d.updated).toLocaleString()}`));
      const open = () => {
        const map = loadDraft(d.id);
        if (map) this.load(map, d.id);
        else void notice('Open', 'That draft could not be read.');
      };
      b.addEventListener('click', () => {
        choose(b, open);
        preview.show(`draft:${d.id}:${d.updated}`, { name: d.name, bases: d.bases, note: 'Your draft' }, async () => loadDraft(d.id));
      });
      b.addEventListener('dblclick', () => {
        open();
        layer()?.querySelector<HTMLButtonElement>('.close')?.click();
      });
      list.append(b);
    }
    if (!drafts.length) list.append(el('p', {}, 'No drafts in this browser yet.'));
    const originals = el('select', { size: 8, class: 'listview' });
    const index = await loadMapIndex();
    for (const m of index) originals.add(new Option(`Level ${m.level}: ${m.name}`, m.id));
    originals.addEventListener('change', () => {
      list.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
      const id = originals.value;
      pick = () => void this.openOriginal(id);
      const m = index.find((x) => x.id === id);
      preview.show(`original:${id}`, { name: m ? m.name : id, note: m ? `Level ${m.level} · opens a copy` : 'Opens a copy' }, async () => parseMap(await loadMap(id)));
    });
    const body = el('div', { class: 'cols open' },
      el('fieldset', { class: 'grow' }, el('legend', {}, 'Your drafts'), list),
      el('fieldset', { class: 'grow' }, el('legend', {}, 'Original maps (opens a copy)'), index.length ? originals : el('p', {}, 'Import the game data to see them.')),
      el('fieldset', { class: 'open-preview' }, el('legend', {}, 'Preview'), preview.root));
    const layer = () => document.querySelector('.dialog-layer');
    const r = await dialog('Open Map', body, [['Open', 'ok'], ['Delete Draft', 'delete'], ['Cancel', 'cancel']]);
    if (r === 'ok') (pick as (() => void) | null)?.();
    if (r === 'delete') {
      const sel = list.querySelector('.on');
      const k = sel ? Array.from(list.children).indexOf(sel) : -1;
      const d = drafts[k];
      if (d && (await dialog('Delete Draft', el('p', {}, `Delete "${d.name}" from this browser?`), [['Delete', 'ok'], ['Cancel', 'cancel']]))) {
        deleteDraft(d.id);
        if (d.id === this.draftId) this.load(newMap(), newDraftId());
      }
    }
  }

  private async openOriginal(id: string): Promise<void> {
    try {
      const map = parseMap(await loadMap(id));
      // An edited original is a new map: version 2, private, named as a copy.
      this.load({ ...map, version: 2, name: `${map.name} (copy)`.slice(0, 64), visibility: 'private', revision: 0, id: null }, newDraftId());
    } catch (err) {
      void notice('Open', err instanceof Error ? err.message : String(err));
    }
  }

  private async saveToLibrary(): Promise<void> {
    this.autosave();
    const ref = await saveToLibrary(this.doc.toMap(), this.thumbnail(), this.doc.library);
    if (!ref) return;
    this.doc.library = ref;
    this.save(false);
    this.flash(`Saved to your library (${ref.visibility}, revision ${ref.revision})`);
  }

  private async browse(): Promise<void> {
    this.autosave();
    const map = await browseLibrary();
    if (!map) return;
    if (!map.id) {
      this.load(map, newDraftId());
      this.save(false);
      return;
    }
    // A library map keeps one draft in this browser; if that draft has changes the library does not, ask which to open.
    const id = `lib-${map.id}`;
    const draft = loadDraft(id);
    if (draft && JSON.stringify(draft) !== JSON.stringify(map)) {
      const r = await dialog('Shared Maps', el('p', {}, `This browser has a draft of "${draft.name}" with changes that are not in the library.`),
        [['Open the Draft', 'draft'], ['Open the Library Copy', 'library'], ['Cancel', 'cancel']]);
      if (!r) return;
      if (r === 'draft') {
        this.load(draft, id);
        return;
      }
    }
    this.load(map, id);
    this.save(false);
  }

  private saveCopy(): void {
    const map = this.doc.toMap();
    map.name = `${map.name} (copy)`.slice(0, 64);
    map.id = null;
    this.load(map, newDraftId());
    this.save(true);
  }

  private exportFile(): void {
    const map = this.doc.toMap();
    const blob = new Blob([JSON.stringify(map, null, 1)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `${map.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'map'}.rfw.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  private importFile(): void {
    const input = el('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const map = parseMap(JSON.parse(await file.text()));
        this.autosave();
        this.load({ ...map, id: null }, newDraftId());
        this.save(false);
      } catch (err) {
        void notice('Import', err instanceof Error ? err.message : String(err));
      }
    });
    input.click();
  }

  // ---- Test play -----------------------------------------------------------------------------------------------------

  private async test(): Promise<void> {
    if (this.testing) return;
    const map = this.doc.toMap();
    const errors = checkMap(map, this.data.defs, this.data.shore).filter((p) => p.level === 'error');
    if (errors.length) {
      this.showTab('problems');
      await notice('Test Play', `Fix the map's ${errors.length === 1 ? 'error' : `${errors.length} errors`} first: ${errors[0]!.message}`);
      return;
    }
    this.autosave();
    this.testing = true;
    try {
      // The match is drawn as the map is being previewed: classic, or the modern view by day or at night.
      const look = this.view.look;
      const id = this.draftId;
      await testPlay(this.data, map, () => {
        document.body.classList.add('testing');
        markTested(id);
      }, { visuals: look === 'classic' ? 'retro' : 'modern', lighting: look === 'night' ? 'night' : 'day' });
    } finally {
      this.testing = false;
      document.body.classList.remove('testing');
      this.refreshGuide();
      this.redraw();
    }
  }

  private async help(): Promise<void> {
    await dialog('Map Editor Help', el('div', { class: 'stack' },
      el('p', {}, 'Paint land and water and the coast follows. Place up to four bases, each with a start (its lift) and at least one flag site, then add buildings and defences. Symmetry repeats every edit on the mirrored side so fair maps stay fair. The Problems tab says what stops a map being played, and fixes the simple ones for you.'),
      el('p', {}, 'The Preview switch draws the map with the game\'s own views while you edit: Classic is the pixel view through its CRT, Modern is the 3D view as the drone\'s feed, and Night is the modern view in a night match, with the buildings\' lights and a little extra moonlight (the Moonlight button) so the map can be read. Test Play starts in the view you are previewing, as dark as a real night.'),
      ...KEY_SECTIONS.flatMap(([title, rows]) => [el('div', { class: 'caption' }, title), keyTable(rows)])),
    [['OK', 'ok']]);
  }
}

boot().catch((err: unknown) => {
  const box = document.getElementById('error')!;
  box.style.display = 'grid';
  box.textContent = err instanceof Error ? err.message : String(err);
});
