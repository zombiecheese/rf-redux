// Drafts saved in this browser (localStorage): the editor keeps every map you work on here until the map library
// can hold them on the server, and remembers which one was open so a page reload or a test play comes back to it.

import { parseMap, type RfwMap } from '@rfw/sim';

const INDEX = 'rfw-editor-drafts';
const PREFIX = 'rfw-editor-draft:';
const OPEN = 'rfw-editor-open';

export interface DraftEntry {
  id: string;
  name: string;
  updated: number;
  bases: number;
  width: number;
  height: number;
  /** A small picture of the map (a data URL), for the Open list. */
  thumb?: string;
}

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function listDrafts(): DraftEntry[] {
  return read<DraftEntry[]>(INDEX, []).sort((a, b) => b.updated - a.updated);
}

export function loadDraft(id: string): RfwMap | null {
  const raw = read<unknown>(PREFIX + id, null);
  if (!raw) return null;
  try {
    return parseMap(raw);
  } catch {
    return null;
  }
}

/** Saves a draft; throws if the browser's storage is full. */
export function saveDraft(id: string, map: RfwMap, thumb?: string): void {
  localStorage.setItem(PREFIX + id, JSON.stringify(map));
  const list = listDrafts().filter((d) => d.id !== id);
  list.push({ id, name: map.name, updated: Date.now(), bases: map.bases.length, width: map.width, height: map.height, thumb });
  localStorage.setItem(INDEX, JSON.stringify(list));
}

export function deleteDraft(id: string): void {
  try {
    localStorage.removeItem(PREFIX + id);
    localStorage.setItem(INDEX, JSON.stringify(listDrafts().filter((d) => d.id !== id)));
  } catch {
    // Nothing to do: storage is unavailable.
  }
}

export function newDraftId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function lastOpen(): string | null {
  try {
    return localStorage.getItem(OPEN);
  } catch {
    return null;
  }
}

export function setLastOpen(id: string): void {
  try {
    localStorage.setItem(OPEN, id);
  } catch {
    // Not remembered; the editor opens a new map next time.
  }
}
