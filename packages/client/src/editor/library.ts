// The game server's map library, from the editor (ed-library, ed-browse): save the map to your account as private,
// unlisted or public, open your maps and their past revisions, and browse everyone's public maps with search,
// sorting, likes and reports. It needs the page to be served by the game server and a signed-in account; drafts in
// this browser keep working without either.

import type { Identity } from '@rfw/net';
import { parseMap, type MapVisibility, type RfwMap } from '@rfw/sim';
import { loadCommon } from '../assets.js';
import { dialog, el, notice, radio } from '../dialogs.js';
import { MapPreview } from '../mappreview.js';
import { ApiError, api, serverAvailable } from '../online/api.js';
import { signIn } from '../online/ui.js';
import type { LibraryRef } from './doc.js';

/** A map as the library lists it. */
export interface LibraryInfo {
  id: string;
  name: string;
  description: string;
  author: string;
  authorId: string;
  visibility: MapVisibility;
  revision: number;
  width: number;
  height: number;
  bases: number;
  playable: boolean;
  plays: number;
  likes: number;
  liked: boolean;
  featured: boolean;
  hidden: boolean;
  hiddenReason: string;
  updated: number;
  hasThumb: boolean;
}

const VISIBILITY_TEXT: Record<MapVisibility, string> = {
  private: 'Private: only you can see and play it.',
  unlisted: 'Unlisted: anyone with the map\'s id can play it, but it is not in the list of shared maps.',
  public: 'Public: listed for everyone to find, play, like and report.',
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function noServer(): Promise<boolean> {
  if (await serverAvailable()) return false;
  await notice('Map Library', 'The map library is on the game server, and this page is running without it. Your drafts are still saved in this browser.');
  return true;
}

async function whoAmI(): Promise<Identity | null> {
  const u = (await api<{ user: Identity | null }>('/api/me').catch(() => ({ user: null }))).user;
  return u && !u.guest ? u : null;
}

async function signedIn(): Promise<Identity | null> {
  return (await whoAmI()) ?? (await signIn());
}

/**
 * Save to Library: asks who may see the map and saves it, as a new revision of the library copy it came from or as
 * a new map. Resolves with where it now is, or null if it was not saved.
 */
export async function saveToLibrary(map: RfwMap, thumb: string | undefined, current: LibraryRef | null): Promise<LibraryRef | null> {
  if (await noServer()) return null;
  const me = await signedIn();
  if (!me) return null;
  const choices = (['private', 'unlisted', 'public'] as const).map((v) => radio('visibility', VISIBILITY_TEXT[v], v === (current?.visibility ?? 'private'), v));
  const body = el('div', { class: 'stack' },
    el('p', {}, current ? `Saves "${map.name}" as revision ${current.revision + 1} in your library, signed ${me.name}.` : `Saves "${map.name}" to your library as a new map, signed ${me.name}.`),
    el('fieldset', { class: 'stack' }, el('legend', {}, 'Who can see it'), ...choices),
    el('p', { class: 'hint' }, 'Maps with errors can only be private. Shared maps are checked by the server and can be hidden by moderators.'));
  const r = await dialog('Save to Library', body, [['Save', 'ok'], ['Cancel', 'cancel']]);
  if (!r) return null;
  const visibility = (choices.map((c) => c.querySelector('input')!).find((i) => i.checked)?.value ?? 'private') as MapVisibility;
  type Saved = { id: string; revision: number };
  const create = () => api<Saved>('/api/maps', { map: { ...map, id: null, revision: 0 }, thumb, visibility });
  try {
    let saved: Saved;
    if (current) {
      try {
        saved = await api<Saved>(`/api/maps/${encodeURIComponent(current.id)}`, { map, thumb, visibility, revision: current.revision }, 'PUT');
      } catch (err) {
        if (!(err instanceof ApiError) || ![403, 404, 409].includes(err.status)) throw err;
        const why = err.status === 409 ? `${err.message}.` : err.status === 403 ? 'That library map belongs to another account.' : 'That map is no longer in the library.';
        if (err.status === 403 && /hid/.test(err.message)) throw err;
        const again = await dialog('Save to Library', el('p', {}, `${why} Save this one as a new map instead?`), [['Save as New Map', 'ok'], ['Cancel', 'cancel']]);
        if (!again) return null;
        saved = await create();
      }
    } else saved = await create();
    return { id: saved.id, revision: saved.revision, visibility };
  } catch (err) {
    await notice('Save to Library', message(err));
    return null;
  }
}

/**
 * Shared Maps: the public maps (search, sort, featured, like, report) and your own (with their revisions). Resolves
 * with the map to open: your own opens as itself, anyone else's as a private copy.
 */
export async function browseLibrary(): Promise<RfwMap | null> {
  if (await noServer()) return null;
  const me = await whoAmI();
  let tab: 'shared' | 'mine' = 'shared';
  let page = 0;
  let chosen: LibraryInfo | null = null;
  let revision: number | null = null;

  const tabs = el('div', { class: 'row' });
  const q = el('input', { type: 'text', placeholder: 'Search names, descriptions, authors', maxLength: 100 });
  const sort = el('select', {});
  for (const [v, l] of [['new', 'Newest'], ['likes', 'Most liked'], ['plays', 'Most played'], ['name', 'Name']]) sort.add(new Option(l, v));
  const featured = el('input', { type: 'checkbox' });
  const filters = el('div', { class: 'row' }, q, sort, el('label', { class: 'radio' }, featured, 'Featured only'));
  const list = el('div', { class: 'drafts' });
  const more = el('button', { type: 'button', class: 'btn' }, 'More…');
  const detail = el('div', { class: 'stack lib-detail' }, el('p', { class: 'hint' }, 'Pick a map to see more about it.'));
  const status = el('p', { class: 'hint' });
  const preview = new MapPreview(loadCommon, { bare: true });

  const button = (label: string, fn: () => void | Promise<void>) => {
    const b = el('button', { type: 'button', class: 'btn' }, label);
    b.addEventListener('click', () => void fn());
    return b;
  };

  const showDetail = async (m: LibraryInfo) => {
    chosen = m;
    revision = null;
    const own = me?.id === m.authorId;
    preview.show(`lib:${m.id}:${m.revision}`, { name: m.name, bases: m.bases },
      () => api<{ map: unknown }>(`/api/maps/${encodeURIComponent(m.id)}`).then((r) => parseMap(r.map)));
    const parts: (HTMLElement | string)[] = [
      preview.root,
      el('b', {}, m.name),
      el('span', {}, `by ${m.author} · ${m.width} × ${m.height}, ${m.bases} base${m.bases === 1 ? '' : 's'} · ${m.likes} like${m.likes === 1 ? '' : 's'}, played ${m.plays} time${m.plays === 1 ? '' : 's'}`),
    ];
    if (m.featured) parts.push(el('span', {}, '★ Featured'));
    if (m.description) parts.push(el('p', { class: 'desc' }, m.description));
    if (own) {
      parts.push(el('span', {}, `${m.visibility[0]!.toUpperCase()}${m.visibility.slice(1)} · revision ${m.revision} · ${new Date(m.updated).toLocaleString()}${m.playable ? '' : ' · has errors'}`));
      if (m.hidden) parts.push(el('p', { class: 'bad' }, `Hidden by the moderators: ${m.hiddenReason}. It can only be private.`));
      const revs = el('select', {});
      revs.add(new Option(`Revision ${m.revision} (latest)`, ''));
      revs.addEventListener('change', () => (revision = revs.value ? Number(revs.value) : null));
      api<{ revisions: { revision: number; at: number }[] }>(`/api/maps/${m.id}/revisions`)
        .then((r) => r.revisions.forEach((x) => revs.add(new Option(`Revision ${x.revision} (${new Date(x.at).toLocaleString()})`, String(x.revision)))))
        .catch(() => {});
      const vis = el('select', {});
      for (const v of ['private', 'unlisted', 'public'] as const) vis.add(new Option(v[0]!.toUpperCase() + v.slice(1), v, false, v === m.visibility));
      vis.addEventListener('change', async () => {
        try {
          const r = await api<{ map: LibraryInfo }>(`/api/maps/${m.id}/visibility`, { visibility: vis.value });
          status.textContent = `"${m.name}" is now ${vis.value}.`;
          Object.assign(m, r.map);
        } catch (err) {
          vis.value = m.visibility;
          status.textContent = message(err);
        }
      });
      let armed = false;
      const del = button('Delete…', async () => {
        if (!armed) {
          armed = true;
          del.textContent = 'Click again to delete';
          return;
        }
        try {
          await api(`/api/maps/${m.id}`, {}, 'DELETE');
          status.textContent = `Deleted "${m.name}" from your library.`;
          detail.replaceChildren();
          chosen = null;
          void load(true);
        } catch (err) {
          status.textContent = message(err);
        }
      });
      parts.push(el('label', { class: 'field' }, el('span', {}, 'Open:'), revs), el('label', { class: 'field' }, el('span', {}, 'Shared:'), vis), el('div', { class: 'row' }, del));
    } else if (me) {
      const like = button(m.liked ? 'Unlike' : '♥ Like', async () => {
        try {
          const r = await api<{ likes: number }>(`/api/maps/${m.id}/like`, { like: !m.liked });
          m.liked = !m.liked;
          m.likes = r.likes;
          void showDetail(m);
        } catch (err) {
          status.textContent = message(err);
        }
      });
      const reason = el('input', { type: 'text', placeholder: 'What is wrong with it?', maxLength: 300 });
      const report = button('Report', async () => {
        try {
          await api(`/api/maps/${m.id}/report`, { reason: reason.value });
          reason.value = '';
          status.textContent = 'Thanks; a moderator will look at it.';
        } catch (err) {
          status.textContent = message(err);
        }
      });
      parts.push(el('div', { class: 'row' }, like), el('div', { class: 'row' }, reason, report), el('p', { class: 'hint' }, 'Opening it makes a private copy for you to change.'));
    } else parts.push(el('p', { class: 'hint' }, 'Sign in to like or report maps. Opening it makes a copy for you to change.'));
    detail.replaceChildren(...parts);
  };

  const load = async (reset: boolean) => {
    if (reset) {
      page = 0;
      list.replaceChildren();
    }
    const params = new URLSearchParams({ page: String(page), sort: sort.value });
    if (tab === 'mine') params.set('mine', '1');
    else params.set('visibility', 'public');
    if (q.value.trim()) params.set('q', q.value.trim());
    if (featured.checked) params.set('featured', '1');
    try {
      const r = await api<{ maps: LibraryInfo[]; total: number; limit?: number }>(`/api/maps?${params}`);
      for (const m of r.maps) {
        const b = el('button', { type: 'button', class: 'draft' }, el('img', { src: m.hasThumb ? `/api/maps/${m.id}/thumb?r=${m.revision}` : '', alt: '' }),
          el('span', {}, el('b', {}, m.name), m.featured ? ' ★' : '', el('br'),
            tab === 'mine' ? `${m.visibility}${m.hidden ? ', hidden' : ''} · ${m.bases} bases · rev ${m.revision}` : `by ${m.author} · ${m.bases} bases · ♥ ${m.likes}`));
        b.addEventListener('click', () => {
          list.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          void showDetail(m);
        });
        b.addEventListener('dblclick', () => (document.querySelector<HTMLButtonElement>('.dialog-layer .btn.default'))?.click());
        list.append(b);
      }
      if (!list.children.length) list.append(el('p', {}, tab === 'mine' ? 'Nothing in your library yet: File > Save to Library puts the open map there.' : 'No maps found.'));
      more.style.display = (page + 1) * 30 < r.total ? '' : 'none';
      status.textContent = tab === 'mine' && r.limit !== undefined ? `${r.total} of ${r.limit} maps used.` : `${r.total} map${r.total === 1 ? '' : 's'}.`;
    } catch (err) {
      status.textContent = message(err);
    }
  };

  const setTab = (t: typeof tab) => {
    tab = t;
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    sort.disabled = featured.disabled = t === 'mine';
    detail.replaceChildren();
    chosen = null;
    void load(true);
  };
  for (const [t, label] of [['shared', 'Shared maps'], ['mine', 'My library']] as const) {
    if (t === 'mine' && !me) continue;
    const b = el('button', { type: 'button', class: 'btn tab' }, label);
    b.dataset.tab = t;
    b.addEventListener('click', () => setTab(t));
    tabs.append(b);
  }
  let timer = 0;
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void load(true), 300);
  });
  sort.addEventListener('change', () => void load(true));
  featured.addEventListener('change', () => void load(true));
  more.addEventListener('click', () => {
    page++;
    void load(false);
  });
  setTab('shared');

  const body = el('div', { class: 'stack library' }, tabs, filters,
    el('div', { class: 'cols' }, el('div', { class: 'grow' }, list, more), el('fieldset', { class: 'grow' }, el('legend', {}, 'Map'), detail)), status);
  const r = await dialog('Shared Maps', body, [['Open', 'ok'], ['Cancel', 'cancel']]);
  const pick = chosen as LibraryInfo | null;
  if (!r || !pick) return null;
  try {
    const own = me?.id === pick.authorId;
    if (own && revision !== null) {
      // An old revision opens in place of the latest; saving it makes it the latest again.
      const old = parseMap((await api<{ map: unknown }>(`/api/maps/${pick.id}/revisions/${revision}`)).map);
      return { ...old, id: pick.id, revision: pick.revision, visibility: pick.visibility };
    }
    const map = parseMap((await api<{ map: unknown }>(`/api/maps/${pick.id}`)).map);
    return own ? map : { ...map, id: null, revision: 0, authorId: null, visibility: 'private' };
  } catch (err) {
    await notice('Shared Maps', message(err));
    return null;
  }
}
