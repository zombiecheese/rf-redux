// The admin panel (admin-dashboard, admin-users, admin-games, admin-chat, admin-site, admin-roles, ed-moderation):
// a full-screen panel in the game page, in the same look as its menus and lobby (ui.css), over the server's
// /api/admin API. Only moderators, admins and the owner see it in the menu (Online > Admin Panel); /admin opens the
// game with it. Sections are listed in SECTIONS; each renders into the panel and shows only to the roles that may
// use it, and the server checks every call again. Actions that need the password again (bans, deletes, roles) ask
// for it and retry.

import { dialog, el, skinClass } from '../dialogs.js';
import { ApiError, api } from '../online/api.js';
import { toast } from '../online/ui.js';

type Role = 'player' | 'moderator' | 'admin' | 'owner';
interface Me { id: string; name: string; role: Role; guest: boolean }

const RANK: Record<Role, number> = { player: 0, moderator: 1, admin: 2, owner: 3 };
let me: Me | null = null;
const can = (r: Role) => !!me && RANK[me.role] >= RANK[r];

// ---- Little DOM helpers ----

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') e.className = String(v);
    else (e as unknown as Record<string, unknown>)[k] = v;
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
}

const when = (t: number | null | undefined) => (t ? new Date(t).toLocaleString() : '-');
const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};

function say(text: string, bad = false): void {
  toast(bad ? `Admin: ${text}` : text);
}

function table(head: string[], rows: (Node | string)[][], onRow?: (i: number) => void): HTMLTableElement {
  return h('table', {}, h('thead', {}, h('tr', {}, ...head.map((x) => h('th', {}, x)))),
    h('tbody', {}, ...(rows.length ? rows.map((r, i) => h('tr', onRow ? { class: 'click', onclick: () => onRow(i) } : {}, ...r.map((c) => h('td', {}, c))))
      : [h('tr', {}, h('td', { colSpan: head.length, class: 'muted' }, 'Nothing here'))])));
}

/** A message with OK. */
async function modal(title: string, body: HTMLElement[]): Promise<void> {
  await dialog(title, h('div', { class: 'stack' }, ...body), [['OK', 'ok']]);
}

async function ask(title: string, fields: { name: string; label: string; type?: string; value?: string; options?: [string, string][] }[], ok = 'OK'): Promise<Record<string, string> | null> {
  const inputs = fields.map((f) => {
    const input = f.options
      ? h('select', {}, ...f.options.map(([v, l]) => h('option', { value: v, selected: v === f.value }, l)))
      : f.type === 'textarea' ? h('textarea', { value: f.value ?? '' }) : h('input', { type: f.type ?? 'text', value: f.value ?? '' });
    return { f, input };
  });
  const body = h('div', { class: 'stack admin-form' }, ...inputs.map(({ f, input }) => h('label', { class: 'f' }, f.label, input)));
  if (!(await dialog(title, body, [[ok, 'ok'], ['Cancel', 'cancel']]))) return null;
  return Object.fromEntries(inputs.map(({ f, input }) => [f.name, (input as HTMLInputElement).value]));
}

/** Calls the API; on 428 asks for the password and tries again. */
async function call<T = Record<string, unknown>>(path: string, body?: unknown, method?: string): Promise<T | null> {
  try {
    return await api<T>(path, body, method);
  } catch (err) {
    if (err instanceof ApiError && err.status === 428) {
      const r = await ask('Confirm it is you', [{ name: 'password', label: 'Password', type: 'password' }], 'Confirm');
      if (!r) return null;
      try {
        await api('/api/auth/reauth', { password: r.password });
      } catch (e) {
        say(e instanceof Error ? e.message : String(e), true);
        return null;
      }
      return call<T>(path, body, method);
    }
    say(err instanceof Error ? err.message : String(err), true);
    return null;
  }
}

// ---- Sections ----

interface Section {
  id: string;
  label: string;
  role: Role;
  render(root: HTMLElement): Promise<void> | void;
}

let refresh: ReturnType<typeof setInterval> | null = null;

const dashboard: Section = {
  id: 'dashboard', label: 'Dashboard', role: 'moderator',
  async render(root) {
    const draw = async () => {
      const d = await call<{
        online: { total: number; players: number; guests: number }; games: number; lobbies: number; openLobbies: number; accounts: number;
        signups: { day: string; n: number }[]; server: { cpu: number; rss: number; heap: number; uptime: number; lag: number };
        desyncs: number; errors: number; messages: number; reports: number; assets: boolean;
      }>('/api/admin/dashboard');
      if (!d) return;
      const tile = (n: string | number, label: string, cls = '') => h('div', { class: 'tile' }, h('b', { class: cls }, String(n)), h('span', {}, label));
      const max = Math.max(1, ...d.signups.map((s) => s.n));
      root.replaceChildren(
        h('div', { class: 'tiles' },
          tile(d.online.total, `online (${d.online.players} signed in, ${d.online.guests} not)`), tile(d.games, 'games running'),
          tile(d.lobbies, `lobbies waiting (${d.openLobbies} open)`), tile(d.accounts, 'accounts'),
          tile(d.reports, 'reports to review', d.reports ? 'warn' : ''), tile(d.desyncs, 'desyncs since start', d.desyncs ? 'warn' : ''),
          tile(d.errors, 'server errors', d.errors ? 'bad' : ''), tile(`${d.server.cpu}%`, 'server CPU'),
          tile(`${Math.round(d.server.rss / 1048576)} MB`, 'memory'), tile(d.server.lag, 'ticks behind (worst game)', d.server.lag > 2 ? 'warn' : ''),
          tile(`${Math.round(d.server.uptime / 3600)}h`, 'uptime'), tile(d.assets ? 'yes' : 'NO', 'game data loaded', d.assets ? 'ok' : 'bad')),
        h('section', {}, h('h2', {}, 'Sign-ups, last 14 days'),
          d.signups.length ? h('div', { class: 'row', style: 'align-items:flex-end;height:90px' }, ...d.signups.map((s) =>
            h('div', { title: `${s.day}: ${s.n}`, style: `width:18px;height:${Math.max(4, (s.n / max) * 80)}px;background:var(--ui-accent);border-radius:3px` })))
            : h('p', { class: 'muted' }, 'None yet')),
      );
    };
    await draw();
    refresh = setInterval(() => void draw(), 5000);
  },
};

const players: Section = {
  id: 'players', label: 'Players', role: 'moderator',
  async render(root) {
    const q = h('input', { type: 'search', placeholder: 'Name or email' });
    const list = h('div');
    const detail = h('div');
    const search = async () => {
      const r = await call<{ users: { id: string; name: string; email?: string; role: Role; lastSeen: number; online: boolean; banned: boolean; suspendedUntil: number; mutedUntil: number }[] }>(`/api/admin/users?q=${encodeURIComponent(q.value)}`);
      if (!r) return;
      const state = (u: (typeof r.users)[number]) => u.banned ? 'banned' : u.suspendedUntil > Date.now() ? 'suspended' : u.mutedUntil > Date.now() ? 'muted' : u.online ? 'online' : '';
      list.replaceChildren(table(['Name', 'Email', 'Role', 'Last seen', 'State'],
        r.users.map((u) => [u.name, u.email ?? '', u.role, ago(u.lastSeen), state(u)]), (i) => void show(r.users[i]!.id)));
    };
    const show = async (id: string) => {
      const u = await call<{
        user: { id: string; name: string; email?: string; role: Role; created: number; verified: boolean; banned: boolean; banReason: string; suspendedUntil: number; mutedUntil: number };
        online: boolean; stats: { games: number; wins: number; losses: number; rating: number };
        warnings: { at: number; by: string; kind: string; reason: string; until: number }[];
        sessions: { created: number; lastSeen: number; ip: string; agent: string }[]; ips: { ip: string; lastSeen: number }[];
        chat: { id: number; at: number; channel: string; text: string; lobby: string }[];
      }>(`/api/admin/users/${id}`);
      if (!u) return;
      const act = async (action: string, extra: Record<string, unknown> = {}, fields: Parameters<typeof ask>[1] = [{ name: 'reason', label: 'Reason' }]) => {
        const f = fields.length ? await ask(`${action} ${u.user.name}`, fields) : {};
        if (!f) return;
        const body: Record<string, unknown> = { action, ...extra, ...f };
        if (f.minutes) body.minutes = Number(f.minutes);
        if (f.ip) body.ip = f.ip === 'yes';
        const r = await call<{ code?: string; note?: string }>(`/api/admin/users/${id}/action`, body);
        if (!r) return;
        if (r.code) await modal('Reset code', [h('p', {}, h('code', {}, r.code)), h('p', { class: 'muted' }, r.note ?? '')]);
        else say('Done');
        void show(id);
        void search();
      };
      const dur: Parameters<typeof ask>[1] = [{ name: 'minutes', label: 'For how long', options: [['60', '1 hour'], ['1440', '1 day'], ['10080', '1 week'], ['43200', '30 days']], value: '1440' }, { name: 'reason', label: 'Reason' }];
      const b = (label: string, fn: () => void, role: Role = 'moderator', danger = false) =>
        can(role) ? h('button', { class: `act${danger ? ' danger' : ''}`, onclick: fn }, label) : null;
      const x = u.user;
      detail.replaceChildren(h('section', {},
        h('h2', {}, `${x.name} `, h('span', { class: 'muted' }, `${x.role}${u.online ? ', online' : ''}`)),
        h('p', {}, x.email ? `${x.email} · ` : '', `joined ${when(x.created)} · ${u.stats.games} games, ${u.stats.wins} won, rating ${Math.round(u.stats.rating)}`,
          x.banned ? h('b', { class: 'bad' }, ` · banned: ${x.banReason}`) : '', x.suspendedUntil > Date.now() ? h('b', { class: 'warn' }, ` · suspended until ${when(x.suspendedUntil)}`) : '',
          x.mutedUntil > Date.now() ? h('b', { class: 'warn' }, ` · muted until ${when(x.mutedUntil)}`) : ''),
        h('div', { class: 'row' },
          b('Warn', () => void act('warn')), b('Mute', () => void act('mute', {}, dur)), b('Unmute', () => void act('unmute', {}, [])),
          b('Suspend', () => void act('suspend', {}, dur), 'admin'), b('Unsuspend', () => void act('unsuspend', {}, []), 'admin'),
          b(x.banned ? 'Unban' : 'Ban', () => void act(x.banned ? 'unban' : 'ban', {}, x.banned ? [] : [{ name: 'reason', label: 'Reason' }, { name: 'ip', label: 'Also ban their IP addresses', options: [['no', 'No'], ['yes', 'Yes']], value: 'no' }]), 'admin', true),
          b('Rename', () => void act('rename', {}, [{ name: 'name', label: 'New name', value: x.name }, { name: 'reason', label: 'Reason' }]), 'admin'),
          b(x.verified ? 'Unverify' : 'Verify', () => void act('verify', { verified: !x.verified }, []), 'admin'),
          b('Reset sign-in', () => void act('reset', {}, []), 'admin'), b('Sign out everywhere', () => void act('signout', {}, []), 'admin'),
          b('Role', () => void act('role', {}, [{ name: 'role', label: 'Role', options: [['player', 'Player'], ['moderator', 'Moderator'], ['admin', 'Admin']], value: x.role }, { name: 'reason', label: 'Reason' }]), 'owner'),
          b('Delete account', () => void act('delete'), 'owner', true)),
        h('div', { class: 'grid2' },
          h('div', {}, h('h2', {}, 'Warnings and actions'), table(['When', 'By', 'What', 'Reason'], u.warnings.map((w) => [when(w.at), w.by, w.kind + (w.until ? ` until ${when(w.until)}` : ''), w.reason]))),
          can('admin') ? h('div', {}, h('h2', {}, 'Addresses and sessions'), table(['IP', 'Last seen'], u.ips.map((i) => [i.ip, ago(i.lastSeen)])),
            table(['Signed in', 'Last seen', 'IP', 'Browser'], u.sessions.map((s) => [when(s.created), ago(s.lastSeen), s.ip, s.agent.slice(0, 60)]))) : null),
        h('h2', {}, 'Recent chat'), h('div', { class: 'scroll' }, table(['When', 'To', 'Message'], u.chat.map((m) => [when(m.at), m.channel, m.text]))),
      ));
    };
    q.addEventListener('input', () => void search());
    root.replaceChildren(h('section', {}, h('div', { class: 'row' }, q, h('button', { class: 'act', onclick: () => void search() }, 'Search')), list), detail);
    await search();
  },
};

const games: Section = {
  id: 'games', label: 'Lobbies & games', role: 'moderator',
  async render(root) {
    const draw = async () => {
      const r = await call<{ lobbies: {
        id: string; name: string; code: string; mapName: string; visibility: string; state: string; created: number; chatMuted: boolean;
        slots: { kind: string; team: number; difficulty?: number }[];
        players: { id: string; name: string; team: number; ping?: number; connected: boolean }[];
        game: { id: string; tick: number; started: number; paused: boolean; lag: number; desyncs: number; spectators: number } | null;
      }[] }>('/api/admin/games');
      if (!r) return;
      const act = async (lobby: string, action: string, extra: Record<string, unknown> = {}, reason = true) => {
        const f = reason ? await ask(`${action}`, [{ name: 'reason', label: 'Reason (shown to players)' }]) : {};
        if (!f) return;
        if (await call(`/api/admin/games/${lobby}/action`, { action, ...extra, ...f })) say('Done');
        void draw();
      };
      root.replaceChildren(...(r.lobbies.length ? r.lobbies.map((l) => h('section', {},
        h('h2', {}, `${l.name} `, h('span', { class: 'muted' }, `${l.mapName} · ${l.visibility} · code ${l.code} · ${l.state}${l.chatMuted ? ' · chat muted' : ''}`)),
        l.game ? h('p', {}, `Game ${l.game.id}: tick ${l.game.tick} (${Math.round((l.game.tick * 16) / 60000)} min), ${l.game.paused ? 'paused, ' : ''}${l.game.spectators} connected, ${l.game.lag} ticks behind, ${l.game.desyncs} desyncs`) : null,
        table(['Player', 'Team', 'Ping', ''], l.players.map((p) => [p.name, 'ABCD'[p.team] ?? '', p.connected ? `${p.ping ?? '?'} ms` : 'gone',
          h('button', { class: 'act', onclick: () => void act(l.id, 'kick', { user: p.id }) }, 'Kick')])),
        h('div', { class: 'row', style: 'margin-top:8px' },
          l.game ? h('a', { href: `/?watch=${l.game.id}`, target: '_blank' }, 'Watch') : null,
          l.game ? h('button', { class: 'act', onclick: () => void act(l.id, l.game!.paused ? 'resume' : 'pause', {}, !l.game!.paused) }, l.game.paused ? 'Resume' : 'Pause') : null,
          l.game && can('admin') ? h('button', { class: 'act danger', onclick: () => void act(l.id, 'end') }, 'End game') : null,
          h('button', { class: 'act', onclick: () => void act(l.id, l.chatMuted ? 'unmute' : 'mute', {}, false) }, l.chatMuted ? 'Unmute chat' : 'Mute chat'),
          l.visibility === 'open' ? h('button', { class: 'act', onclick: () => void act(l.id, 'private', {}, false) }, 'Make private') : null,
          h('button', { class: 'act', onclick: async () => {
            const f = await ask('Message to this game', [{ name: 'text', label: 'Message' }]);
            if (f && (await call(`/api/admin/games/${l.id}/action`, { action: 'broadcast', text: f.text }))) say('Sent');
          } }, 'Message'),
          can('admin') ? h('button', { class: 'act danger', onclick: () => void act(l.id, 'close') }, 'Close lobby') : null),
      )) : [h('section', {}, h('p', { class: 'muted' }, 'No lobbies or games right now.'))]),
      can('admin') ? h('section', {}, h('h2', {}, 'Message everyone'), h('button', { class: 'act', onclick: async () => {
        const f = await ask('Message to every player online', [{ name: 'text', label: 'Message' }]);
        if (f && (await call('/api/admin/broadcast', { text: f.text }))) say('Sent');
      } }, 'Broadcast...')) : '');
    };
    await draw();
    refresh = setInterval(() => void draw(), 5000);
  },
};

const chat: Section = {
  id: 'chat', label: 'Chat', role: 'moderator',
  async render(root) {
    const reports = h('div');
    const logs = h('div');
    const drawReports = async () => {
      const r = await call<{ reports: { id: number; at: number; reporter: { name: string }; reason: string; message: { id: number; text: string; from: { name: string } | null; at: number } }[] }>('/api/admin/reports');
      if (!r) return;
      const act = async (id: number, action: string) => {
        const fields: Parameters<typeof ask>[1] = [{ name: 'reason', label: 'Note' }];
        if (action === 'mute' || action === 'suspend') fields.unshift({ name: 'minutes', label: 'For how long', options: [['60', '1 hour'], ['1440', '1 day'], ['10080', '1 week']], value: action === 'mute' ? '60' : '1440' });
        const f = await ask(action, fields);
        if (!f) return;
        if (await call(`/api/admin/reports/${id}`, { action, ...f, minutes: f.minutes ? Number(f.minutes) : undefined })) say('Done');
        void drawReports();
      };
      reports.replaceChildren(h('h2', {}, `Reports (${r.reports.length})`), table(['When', 'From', 'Message', 'Reported by', ''], r.reports.map((x) => [
        when(x.at), x.message.from?.name ?? '?', x.message.text, `${x.reporter.name}: ${x.reason}`,
        h('div', { class: 'row' }, ...['dismiss', 'warn', 'mute', ...(can('admin') ? ['suspend'] : [])].map((a) => h('button', { class: 'act', onclick: () => void act(x.id, a) }, a))),
      ])));
    };
    const text = h('input', { type: 'search', placeholder: 'Text' });
    const user = h('input', { type: 'search', placeholder: 'Player name or id' });
    const search = async () => {
      const r = await call<{ messages: { at: number; channel: string; from: { name: string } | null; to?: { name: string }; text: string; lobby: string }[] }>(
        `/api/admin/chat?text=${encodeURIComponent(text.value)}&user=${encodeURIComponent(user.value)}`);
      if (r) logs.replaceChildren(h('div', { class: 'scroll' }, table(['When', 'From', 'To', 'Message', 'Lobby'],
        r.messages.map((m) => [when(m.at), m.from?.name ?? 'system', m.channel === 'whisper' ? m.to?.name ?? '' : m.channel, m.text, m.lobby]))));
    };
    text.addEventListener('change', () => void search());
    user.addEventListener('change', () => void search());
    const parts: HTMLElement[] = [h('section', {}, reports), h('section', {}, h('h2', {}, 'Chat log'), h('div', { class: 'row' }, text, user, h('button', { class: 'act', onclick: () => void search() }, 'Search')), logs)];
    if (can('admin')) {
      const s = await call<{ settings: { wordFilter: string[]; slowMode: number; chatRetentionDays: number } }>('/api/admin/settings');
      if (s) {
        const words = h('textarea', { value: s.settings.wordFilter.join('\n') });
        const slow = h('input', { type: 'number', min: 0, max: 600, value: String(s.settings.slowMode) });
        const keep = h('input', { type: 'number', min: 1, max: 3650, value: String(s.settings.chatRetentionDays) });
        parts.push(h('section', {}, h('h2', {}, 'Filter and limits'),
          h('label', { class: 'f' }, 'Blanked words, one per line', words),
          h('div', { class: 'row' }, h('label', { class: 'f' }, 'Slow mode: seconds between a player\'s messages (0 off)', slow), h('label', { class: 'f' }, 'Keep chat logs for days', keep)),
          h('button', { class: 'act primary', onclick: async () => {
            if (await call('/api/admin/settings', { settings: { wordFilter: words.value.split('\n'), slowMode: Number(slow.value), chatRetentionDays: Number(keep.value) } }, 'PUT')) say('Saved');
          } }, 'Save')));
      }
    }
    root.replaceChildren(...parts);
    await Promise.all([drawReports(), search()]);
  },
};

const site: Section = {
  id: 'site', label: 'Site', role: 'admin',
  async render(root) {
    const r = await call<{ settings: {
      signups: string; maintenance: { at: number; message: string } | null; motd: string; news: { at: number; title: string; text: string }[];
      maxGames: number; maxPerIp: number; featuredMaps: string[]; defaultDifficulty: number; replayLimit: number;
    }; maps: { id: string; name: string; level?: number }[] }>('/api/admin/settings');
    if (!r) return;
    const s = r.settings;
    const signups = h('select', {}, ...[['open', 'Open'], ['invite', 'Invite only'], ['closed', 'Closed']].map(([v, l]) => h('option', { value: v, selected: s.signups === v }, l)));
    const motd = h('input', { type: 'text', value: s.motd, style: 'width:100%' });
    const maxGames = h('input', { type: 'number', min: 1, max: 1000, value: String(s.maxGames) });
    const maxPerIp = h('input', { type: 'number', min: 1, max: 100, value: String(s.maxPerIp) });
    const replayLimit = h('input', { type: 'number', min: 0, max: 1000, value: String(s.replayLimit) });
    const diff = h('select', {}, ...Array.from({ length: 9 }, (_, i) => h('option', { value: String(i + 1), selected: s.defaultDifficulty === i + 1 }, String(i + 1))));
    const featured = h('select', { multiple: true, size: 10 }, ...r.maps.map((m) => h('option', { value: m.id, selected: s.featuredMaps.includes(m.id) }, `${m.level ? `${m.level}: ` : ''}${m.name}`)));
    const mMinutes = h('input', { type: 'number', min: 0, value: s.maintenance ? String(Math.max(0, Math.round((s.maintenance.at - Date.now()) / 60000))) : '15' });
    const mText = h('input', { type: 'text', value: s.maintenance?.message ?? 'Server restarting for an update', style: 'width:100%' });
    const news = h('textarea', { value: s.news.map((n) => `${n.title}\n${n.text}`).join('\n---\n') });
    const save = async (patch: Record<string, unknown>) => {
      if (await call('/api/admin/settings', { settings: patch }, 'PUT')) say('Saved');
    };
    root.replaceChildren(
      h('div', { class: 'grid2' },
        h('section', {}, h('h2', {}, 'Players'),
          h('label', { class: 'f' }, 'Sign-ups', signups),
          h('label', { class: 'f' }, 'Most games at once', maxGames), h('label', { class: 'f' }, 'Connections per IP address', maxPerIp),
          h('label', { class: 'f' }, 'Default difficulty for new lobbies', diff),
          h('label', { class: 'f' }, 'Replays one account keeps (0: none)', replayLimit),
          h('div', { class: 'row', style: 'margin-top:8px' },
            h('button', { class: 'act primary', onclick: () => void save({
              signups: signups.value, maxGames: Number(maxGames.value), maxPerIp: Number(maxPerIp.value), defaultDifficulty: Number(diff.value),
              replayLimit: Number(replayLimit.value),
            }) }, 'Save'),
            h('button', { class: 'act', onclick: async () => {
              const c = await call<{ code: string }>('/api/admin/invites', {});
              if (c) await modal('Invite code', [h('p', {}, 'Give this code to the person to sign up with (it works once): ', h('code', {}, c.code))]);
            } }, 'New invite code'))),
        h('section', {}, h('h2', {}, 'Title screen'), h('label', { class: 'f' }, 'Message of the day', motd),
          h('label', { class: 'f' }, 'News: title on the first line, then the text; separate items with a line of ---', news),
          h('button', { class: 'act primary', onclick: () => void save({
            motd: motd.value,
            news: news.value.split(/\n---\n/).map((x) => x.trim()).filter(Boolean).map((x) => {
              const [title, ...rest] = x.split('\n');
              return { at: Date.now(), title: title ?? '', text: rest.join('\n') };
            }),
          }) }, 'Save'))),
      h('div', { class: 'grid2' },
        h('section', {}, h('h2', {}, 'Maintenance'),
          s.maintenance ? h('p', { class: 'warn' }, `Set for ${when(s.maintenance.at)}: ${s.maintenance.message}`) : h('p', { class: 'muted' }, 'Not scheduled'),
          h('label', { class: 'f' }, 'Starts in minutes (no new games from a minute before)', mMinutes), h('label', { class: 'f' }, 'Message', mText),
          h('div', { class: 'row', style: 'margin-top:8px' },
            h('button', { class: 'act primary', onclick: () => void save({ maintenance: { at: Date.now() + Number(mMinutes.value) * 60000, message: mText.value } }) }, 'Schedule'),
            h('button', { class: 'act', onclick: () => void save({ maintenance: null }) }, 'Cancel maintenance'))),
        h('section', {}, h('h2', {}, 'Featured maps (quick match and the top of the map list)'), featured,
          h('div', { class: 'row', style: 'margin-top:8px' },
            h('button', { class: 'act primary', onclick: () => void save({ featuredMaps: Array.from(featured.selectedOptions).map((o) => o.value) }) }, 'Save'),
            h('button', { class: 'act', onclick: async () => {
              const x = await call<{ ready: boolean; maps: number }>('/api/admin/assets/reload', {});
              if (x) say(x.ready ? `Game data reloaded: ${x.maps} maps` : 'No game data found', !x.ready);
            } }, 'Reload game data')))),
    );
  },
};

const maps: Section = {
  id: 'maps', label: 'Maps', role: 'moderator',
  async render(root) {
    interface MapRow {
      id: string; name: string; description: string; author: string; authorId: string; visibility: string; plays: number; likes: number;
      featured: boolean; hidden: boolean; hiddenReason: string; updated: number; hasThumb: boolean; reports: number; width: number; height: number; bases: number;
    }
    const filter = h('select', {}, ...[['reported', 'Reported'], ['shared', 'Public and unlisted'], ['hidden', 'Hidden'], ['featured', 'Featured'], ['all', 'All maps']]
      .map(([v, l]) => h('option', { value: v }, l)));
    const q = h('input', { type: 'search', placeholder: 'Map name, author or id' });
    const list = h('div');
    const detail = h('div');
    const draw = async () => {
      const r = await call<{ maps: MapRow[]; openReports: number }>(`/api/admin/maps?filter=${filter.value}&q=${encodeURIComponent(q.value)}`);
      if (!r) return;
      list.replaceChildren(h('p', { class: 'muted' }, `${r.openReports} map${r.openReports === 1 ? '' : 's'} with open reports`),
        h('div', { class: 'scroll' }, table(['', 'Map', 'Author', 'Shared', 'Reports', 'Likes', 'Plays', 'Updated'], r.maps.map((m) => [
          m.hasThumb ? h('img', { src: `/api/maps/${m.id}/thumb`, width: 32, height: 32, style: 'image-rendering:pixelated' }) : '',
          h('span', {}, m.name, m.featured ? h('b', { class: 'ok' }, ' featured') : '', m.hidden ? h('b', { class: 'bad' }, ' hidden') : ''),
          m.author, m.visibility, m.reports ? h('b', { class: 'warn' }, String(m.reports)) : '0', String(m.likes), String(m.plays), ago(m.updated),
        ]), (i) => void show(r.maps[i]!))));
    };
    const show = async (m: MapRow) => {
      const [rep, lim] = await Promise.all([
        call<{ reports: { id: number; at: number; reporter: string; reason: string; resolved: number; resolution: string }[] }>(`/api/admin/maps/${m.id}/reports`),
        call<{ limit: number; custom: number | null; maps: number }>(`/api/admin/users/${m.authorId}/map-limit`),
      ]);
      if (!rep || !lim) return;
      const act = async (action: string, needReason = true) => {
        const f = needReason ? await ask(`${action} "${m.name}"`, [{ name: 'reason', label: action === 'hide' ? 'Reason (the author sees it)' : 'Note' }]) : {};
        if (!f) return;
        if (await call(`/api/admin/maps/${m.id}/action`, { action, ...f })) say('Done');
        detail.replaceChildren();
        void draw();
      };
      const setLimit = async () => {
        const f = await ask(`Map limit for ${m.author}`, [{ name: 'max', label: `Maps they may keep (empty for the site's limit)`, type: 'number', value: lim.custom === null ? '' : String(lim.custom) }, { name: 'reason', label: 'Reason' }]);
        if (!f) return;
        if (await call(`/api/admin/users/${m.authorId}/map-limit`, { max: f.max === '' ? null : Number(f.max), reason: f.reason }, 'PUT')) say('Saved');
        void show(m);
      };
      const b = (label: string, fn: () => void, role: Role = 'moderator', danger = false) =>
        can(role) ? h('button', { class: `act${danger ? ' danger' : ''}`, onclick: fn }, label) : null;
      detail.replaceChildren(h('section', {},
        h('h2', {}, `${m.name} `, h('span', { class: 'muted' }, `by ${m.author} · ${m.width} × ${m.height}, ${m.bases} bases · ${m.visibility}`)),
        m.description ? h('p', {}, m.description) : null,
        m.hidden ? h('p', { class: 'bad' }, `Hidden: ${m.hiddenReason}`) : null,
        h('p', { class: 'muted' }, `${m.author} has ${lim.maps} map${lim.maps === 1 ? '' : 's'} of ${lim.limit} allowed${lim.custom === null ? ' (site limit)' : ''}. Id ${m.id}`),
        h('div', { class: 'row' },
          m.reports ? b('Dismiss reports', () => void act('dismiss', false)) : null,
          m.hidden ? b('Unhide', () => void act('unhide')) : b('Hide', () => void act('hide'), 'moderator', true),
          m.visibility !== 'private' ? b('Make private', () => void act('unpublish')) : null,
          m.featured ? b('Unfeature', () => void act('unfeature', false), 'admin') : m.visibility === 'public' && !m.hidden ? b('Feature', () => void act('feature', false), 'admin') : null,
          b('Map limit…', () => void setLimit(), 'admin'),
          b('Delete map', () => void act('delete'), 'admin', true)),
        h('h2', { style: 'margin-top:14px' }, 'Reports'),
        table(['When', 'By', 'Reason', 'Outcome'], rep.reports.map((x) => [when(x.at), x.reporter, x.reason, x.resolved ? x.resolution : h('b', { class: 'warn' }, 'open')]))));
    };
    filter.addEventListener('change', () => void draw());
    q.addEventListener('change', () => void draw());
    const parts: HTMLElement[] = [h('section', {}, h('div', { class: 'row' }, filter, q, h('button', { class: 'act', onclick: () => void draw() }, 'Search')), list), detail];
    if (can('admin')) {
      const s = await call<{ settings: { mapLimit: number; mapNameFilter: string[] } }>('/api/admin/settings');
      if (s) {
        const limit = h('input', { type: 'number', min: 0, max: 10000, value: String(s.settings.mapLimit) });
        const words = h('textarea', { value: s.settings.mapNameFilter.join('\n') });
        parts.push(h('section', {}, h('h2', {}, 'Map rules'),
          h('label', { class: 'f' }, 'Maps one account may keep (0 stops saving maps)', limit),
          h('label', { class: 'f' }, 'Words refused in shared maps\' names and descriptions, one per line (the chat filter applies too)', words),
          h('button', { class: 'act primary', onclick: async () => {
            if (await call('/api/admin/settings', { settings: { mapLimit: Number(limit.value), mapNameFilter: words.value.split('\n') } }, 'PUT')) say('Saved');
          } }, 'Save')));
      }
    }
    root.replaceChildren(...parts);
    await draw();
  },
};

const audit: Section = {
  id: 'audit', label: 'Audit log', role: 'owner',
  async render(root) {
    const r = await call<{ entries: { at: number; actorName: string; action: string; target: string; detail: string; reason: string }[] }>('/api/admin/audit');
    if (!r) return;
    root.replaceChildren(h('section', {}, h('h2', {}, 'Every admin and moderator action'),
      h('div', { class: 'scroll' }, table(['When', 'Who', 'Action', 'On', 'Why', 'Details'], r.entries.map((e) => [when(e.at), e.actorName, e.action, e.target, e.reason, e.detail.slice(0, 120)])))));
  },
};

/** The panel's sections, in menu order. */
export const SECTIONS: Section[] = [dashboard, players, games, chat, maps, site, audit];

// ---- Shell ----

let layer: HTMLDivElement | null = null;

/**
 * Opens the panel over the game at a section (the first one the account may use if that one is not). Resolves when
 * it is closed. Accounts below moderator get a notice instead; the server refuses their calls anyway.
 */
export async function openAdmin(start = 'dashboard'): Promise<void> {
  if (layer) return;
  me = (await api<{ user: Me | null }>('/api/me').catch(() => ({ user: null }))).user;
  if (!can('moderator')) return void toast('The admin panel is for the site\'s moderators and admins.');
  const allowed = SECTIONS.filter((s) => can(s.role));
  const nav = h('nav', { class: 'admin-nav', role: 'tablist' });
  const main = h('div', { class: 'admin-main' });
  let done = () => {};
  const closed = new Promise<void>((resolve) => (done = resolve));
  const close = () => {
    if (refresh) clearInterval(refresh);
    refresh = null;
    removeEventListener('keydown', onKey, { capture: true });
    layer?.remove();
    layer = null;
    done();
  };
  const onKey = (e: KeyboardEvent) => {
    // A dialog over the panel (a password check) has the keyboard first.
    if (document.querySelector('.dialog-layer:not(.lobby-layer):not(.admin-layer)')) return;
    e.stopImmediatePropagation();
    if (e.code === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  const show = async (id: string) => {
    if (refresh) clearInterval(refresh);
    refresh = null;
    const s = allowed.find((x) => x.id === id) ?? allowed[0]!;
    nav.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.id === s.id);
      b.setAttribute('aria-selected', String(b.dataset.id === s.id));
    });
    main.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    await s.render(main);
  };
  for (const s of allowed) {
    const b = h('button', { type: 'button', onclick: () => void show(s.id) }, s.label);
    b.dataset.id = s.id;
    b.setAttribute('role', 'tab');
    nav.append(b);
  }
  const shut = el('button', { type: 'button', class: 'close', ariaLabel: 'Close' }, '×');
  shut.addEventListener('click', close);
  const win = el('div', { class: `${skinClass()} window admin-window`, role: 'dialog' } as Partial<HTMLElement>,
    el('div', { class: 'titlebar' }, el('span', {}, 'Admin Panel'), el('span', { class: 'admin-who' }, `${me!.name} · ${me!.role}`), shut),
    nav, el('div', { class: 'body' }, main));
  win.setAttribute('aria-label', 'Admin Panel');
  layer = el('div', { class: 'dialog-layer admin-layer' }, win);
  document.body.append(layer);
  addEventListener('keydown', onKey, { capture: true });
  await show(start);
  return closed;
}
