// Online > Friends: your friends with what they are doing, requests to answer, invites to lobbies, and a box to ask
// someone by name. The server side is packages/server/src/friends.ts; the list refreshes while the window is open
// and when the server says it changed.

import type { FriendInfo, FriendsList } from '@rfw/net';
import { dialog, el, finish } from '../dialogs.js';
import { api } from './api.js';
import { net } from './net.js';

/** Invites that came in, newest last, until they are answered or the lobby is gone. */
export const invites: { from: string; lobbyName: string; code: string; at: number }[] = [];
/** Invites older than this are dropped. */
const INVITE_MS = 10 * 60_000;
const REFRESH_MS = 5000;

export function addInvite(i: { from: string; lobbyName: string; code: string }): void {
  const at = Date.now();
  for (let k = invites.length - 1; k >= 0; k--) if (invites[k]!.from === i.from || at - invites[k]!.at > INVITE_MS) invites.splice(k, 1);
  invites.push({ ...i, at });
}

const STATUS: Record<FriendInfo['status'], string> = {
  offline: 'Offline', online: 'Online', lobby: 'In a lobby', playing: 'Playing', watching: 'Watching a game',
};

export type FriendsChoice = { join: string } | { watch: string } | { code: string } | null;

/** The Friends window: resolves with a lobby to join, a game to watch or an invite's code, or null. */
export async function friendsDialog(): Promise<FriendsChoice> {
  const list = el('div', { class: 'friends-list', role: 'list' } as Partial<HTMLElement>);
  const message = el('p', { class: 'hint' });
  const name = el('input', { type: 'text', maxLength: 40, placeholder: 'Player name', autocomplete: 'off' });
  const say = (text: string) => (message.textContent = text);
  const call = (path: string, body?: unknown, method?: string) =>
    api(path, body, method).then(() => fill(), (err: Error) => say(err.message));
  const btn = (label: string, fn: () => unknown, cls = 'btn small quiet') => {
    const b = el('button', { type: 'button', class: cls }, label);
    b.addEventListener('click', () => void fn());
    return b;
  };
  const path = (n: string, rest = '') => `/api/friends/${encodeURIComponent(n)}${rest}`;
  const row = (title: string, sub: string, cls: string, ...actions: HTMLElement[]) =>
    el('div', { class: `friend-row ${cls}`, role: 'listitem' } as Partial<HTMLElement>,
      el('div', { class: 'friend-main' }, el('div', { class: 'friend-name' }, title), el('div', { class: 'hint' }, sub)),
      el('div', { class: 'row' }, ...actions));
  const fill = async () => {
    const r = await api<FriendsList>('/api/friends').catch((err: Error) => (say(err.message), null));
    if (!r) return;
    const inLobby = !!net.lobby;
    const now = Date.now();
    list.replaceChildren(
      ...invites.filter((i) => now - i.at < INVITE_MS).map((i) => row(`${i.from} invited you`, i.lobbyName, 'invite',
        btn('Join', () => finish(list, `code:${i.code}`), 'btn small default'),
        btn('No thanks', () => (invites.splice(invites.indexOf(i), 1), fill())))),
      ...r.incoming.map((n) => row(n, 'Wants to be your friend', 'request',
        btn('Accept', () => call(path(n, '/accept'), {}), 'btn small default'), btn('Decline', () => call(path(n), {}, 'DELETE')))),
      ...r.friends.map((f) => row(f.name, f.lobbyName ? `${STATUS[f.status]}: ${f.lobbyName}` : STATUS[f.status], f.status,
        ...(f.joinId ? [btn('Join', () => finish(list, `join:${f.joinId}`), 'btn small default')] : []),
        ...(f.gameId ? [btn('Watch', () => finish(list, `watch:${f.gameId}`))] : []),
        ...(inLobby && f.status !== 'offline' ? [btn('Invite', () => api(path(f.name, '/invite'), {}).then(() => say(`Invited ${f.name}`), (e: Error) => say(e.message)))] : []),
        btn('Remove', () => call(path(f.name), {}, 'DELETE')))),
      ...r.outgoing.map((n) => row(n, 'Asked; waiting for an answer', 'outgoing', btn('Cancel', () => call(path(n), {}, 'DELETE')))));
    if (!list.children.length) list.append(el('div', { class: 'empty' }, 'No friends yet. Ask someone by their player name below.'));
  };
  const ask = btn('Ask', () => {
    const n = name.value.trim();
    if (!n) return;
    return api<{ state: string }>('/api/friends', { name: n }).then((r) => {
      name.value = '';
      say(r.state === 'friends' ? `You and ${n} are friends` : `Asked ${n}`);
      return fill();
    }, (err: Error) => say(err.message));
  }, 'btn default');
  // The box keeps its keys from the dialog (which would take Enter for Close), so Enter asks.
  name.dataset.captureKeys = '';
  name.addEventListener('keydown', (e) => {
    if (e.code !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    ask.click();
  });
  await fill();
  const timer = setInterval(() => void fill(), REFRESH_MS);
  const offs = [net.on('friends', () => void fill()), net.on('invite', () => void fill()), net.on('lobby', () => void fill())];
  const r = await dialog('Friends', el('div', { class: 'stack friends' },
    el('div', { class: 'scroll' }, list), el('div', { class: 'toolbar' }, name, ask), message), [['Close', 'cancel']]);
  clearInterval(timer);
  offs.forEach((off) => off());
  if (r?.startsWith('join:')) return { join: r.slice(5) };
  if (r?.startsWith('watch:')) return { watch: r.slice(6) };
  if (r?.startsWith('code:')) return { code: r.slice(5) };
  return null;
}
