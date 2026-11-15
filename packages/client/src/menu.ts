// The on-screen menu: big buttons over the title art, with sub-menus that slide in beside a Back button, in place
// of the original's Windows 95 menu bar. It works the same with a mouse, a finger or the keyboard (MENU_KEYS, Tab,
// Enter), and sizes itself to the window's height so it reads the same on a phone held sideways and on a monitor.

import { dialogOpen, el } from './dialogs.js';
import { MENU_KEYS, typingIn } from './keys.js';
import type { Logo } from './logo.js';

export interface MenuEntry {
  label: string;
  /** A second line under the label. */
  hint?: string;
  /** The keyboard shortcut, shown on the right (keys.ts). */
  key?: string;
  /** A setting's current value (On, Off, Fill...), shown on the right; pressing the entry changes it. */
  value?: () => string;
  action?: () => void;
  /** A sub-menu, built each time it opens so it shows the current state. */
  items?: () => MenuEntry[];
  enabled?: () => boolean;
  /** The menu's main entry, drawn in the accent colour. */
  primary?: boolean;
  /** A line of text, not a button: a status ("Signed in as ..."). */
  note?: true;
  /** A sub-menu that keeps the menu's footer line (the account, under Online); the others leave it to the first level. */
  footer?: true;
}

interface Level {
  title: string;
  items: () => MenuEntry[];
  focus: number;
  footer?: boolean;
}

const has = (keys: readonly string[], code: string) => keys.includes(code);

export class Menu {
  readonly root = el('nav', { class: 'ui main-menu' } as Partial<HTMLElement>);
  private readonly head = el('div', { class: 'menu-head' });
  private readonly list = el('div', { class: 'menu-list', role: 'menu' } as Partial<HTMLElement>);
  private readonly foot = el('div', { class: 'menu-foot' });
  private stack: Level[] = [];
  private footer: () => string = () => '';
  /** Drawn in place of the first level's title, when the menu opens with one. */
  private logo: Logo | null = null;

  /**
   * @param onClose Esc on the first level: the caller decides what closing means (back to the title art, or back
   * to the match).
   */
  constructor(private readonly onClose: () => void) {
    this.root.hidden = true;
    this.root.append(el('div', { class: 'menu-panel' }, this.head, this.list, this.foot));
    this.root.setAttribute('aria-label', 'Menu');
    addEventListener('keydown', (e) => this.key(e), { capture: true });
    document.body.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Shows the menu at its first level, headed by the logo if one is given, else by the title. */
  open(title: string, items: () => MenuEntry[], footer: () => string = () => '', logo: Logo | null = null): void {
    this.stack = [{ title, items, focus: 0 }];
    this.footer = footer;
    this.logo = logo;
    this.root.hidden = false;
    document.body.classList.add('menu-open');
    this.render();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.stack = [];
    document.body.classList.remove('menu-open');
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  /** Draws the open level again, after a setting changed or someone signed in. */
  refresh(): void {
    if (this.isOpen) this.render(this.focusedIndex());
  }

  private get level(): Level {
    return this.stack[this.stack.length - 1]!;
  }

  private back(): void {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.render(this.level.focus);
    } else this.onClose();
  }

  private enter(title: string, items: () => MenuEntry[], footer = false): void {
    this.level.focus = this.focusedIndex();
    this.stack.push({ title, items, focus: 0, footer });
    this.render();
  }

  private buttons(): HTMLButtonElement[] {
    return Array.from(this.list.querySelectorAll<HTMLButtonElement>('button.mi:not(:disabled)'));
  }

  private focusedIndex(): number {
    return Math.max(0, this.buttons().indexOf(document.activeElement as HTMLButtonElement));
  }

  private render(focus = 0): void {
    const level = this.level;
    this.head.replaceChildren();
    if (this.stack.length > 1) {
      const back = el('button', { type: 'button', class: 'mi-back', ariaLabel: 'Back' }, '‹');
      back.addEventListener('click', () => this.back());
      this.head.append(back);
    }
    if (this.stack.length === 1 && this.logo) {
      this.head.append(this.logo.canvas);
      this.logo.start();
    } else this.head.append(el('span', { class: 'menu-title' }, level.title));
    this.foot.textContent = this.stack.length === 1 || level.footer ? this.footer() : '';
    this.list.replaceChildren();
    for (const it of level.items()) {
      if (it.note) {
        this.list.append(el('div', { class: 'mi-note' }, it.label));
        continue;
      }
      const side = it.items ? '›' : it.value ? it.value() : it.key ?? '';
      const b = el('button', { type: 'button', class: 'mi' + (it.primary ? ' primary' : ''), disabled: !(it.enabled?.() ?? true) },
        el('span', { class: 'mi-text' }, el('span', { class: 'mi-label' }, it.label), it.hint ? el('span', { class: 'mi-hint' }, it.hint) : ''),
        el('span', { class: it.value ? 'mi-value' : it.items ? 'mi-more' : 'mi-key' }, side));
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', () => {
        if (it.items) this.enter(it.label, it.items, !!it.footer);
        else if (it.value) {
          it.action?.();
          this.refresh();
        } else it.action?.();
      });
      // Pointing at an entry moves the keyboard focus with it, so the two never disagree.
      b.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && document.activeElement !== b && b.focus({ preventScroll: true }));
      this.list.append(b);
    }
    const all = this.buttons();
    all[Math.min(focus, all.length - 1)]?.focus({ preventScroll: false });
  }

  private key(e: KeyboardEvent): void {
    // A dialog over the menu, or a text box, has the keyboard.
    if (!this.isOpen || dialogOpen() || typingIn(e)) return;
    const all = this.buttons();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    // The keys the menu answers go no further; the rest reach the shortcuts (main.ts), but never the match, which
    // takes no keys while the menu is open (game.ts).
    const take = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const move = (to: number) => {
      take();
      all[(to + all.length) % all.length]?.focus();
    };
    if (has(MENU_KEYS.prev, e.code)) move(at < 0 ? all.length - 1 : at - 1);
    else if (has(MENU_KEYS.next, e.code)) move(at + 1);
    else if (has(MENU_KEYS.open, e.code)) {
      take();
      if (at >= 0 && all[at]!.querySelector('.mi-more')) all[at]!.click();
    } else if (has(MENU_KEYS.back, e.code) || has(MENU_KEYS.close, e.code)) {
      take();
      if (!e.repeat && (this.stack.length > 1 || has(MENU_KEYS.close, e.code))) this.back();
    } else if (e.code === 'Tab' || ((e.code === 'Enter' || e.code === 'Space') && at >= 0 && !e.altKey)) {
      // Tab moves between the buttons; Enter and Space press the focused one, as on any page.
      e.stopImmediatePropagation();
    } else if ((e.code === 'Enter' || e.code === 'Space') && !e.altKey) move(0);
  }
}
