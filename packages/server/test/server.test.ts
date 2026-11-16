import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HASH_EVERY, buildWorld, createMatch, hashMatch, restoreMatch, type Match,
} from '@rfw/sim';
import {
  PROTOCOL_VERSION, applyFrame, humanGate, decodeFrames, encodeCommand, encodeHash, encodeInput,
  type ClientMessage, type Frame, type MatchStart, type ServerMessage,
} from '@rfw/net';
import { Limiter } from '../src/limits.js';
import { createGameServer, type GameServer } from '../src/server.js';
import { ARENA_DEFS, arenaMap } from '../../sim/test/arena.js';

let game: GameServer;
let base: string;

beforeAll(async () => {
  game = createGameServer({
    clientDir: '/nonexistent', assetsDir: '/nonexistent', dataDir: null, trustProxy: false, secureCookies: false, backupHours: 0, backupKeep: 1, apiRate: 1000,
  });
  game.maps.defs = ARENA_DEFS;
  const arenas: Record<string, ReturnType<typeof arenaMap>> = { arena2: arenaMap(2), arena4: arenaMap(4) };
  game.maps.addSource({ name: 'test', get: (id) => arenas[id] ?? null });
  game.settings.set({ featuredMaps: ['arena2'] });
  expect(await game.accounts.ensureOwner({ name: 'Robin', email: 'robin@example.com', password: 'correct horse' })).toBe('created');
  await new Promise<void>((r) => game.server.listen(0, '127.0.0.1', r));
  base = `127.0.0.1:${(game.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await game.close();
});

async function api(path: string, body?: unknown, cookie = '', method = body ? 'POST' : 'GET'): Promise<{ status: number; json: Record<string, unknown>; cookie: string }> {
  const res = await fetch(`http://${base}${path}`, {
    method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { status: res.status, json: (await res.json()) as Record<string, unknown>, cookie: set || cookie };
}

/** A test player: a WebSocket that keeps every message and plays the match it is given. */
class Client {
  ws!: WebSocket;
  msgs: ServerMessage[] = [];
  frames: Frame[] = [];
  match: Match | null = null;
  start: MatchStart | null = null;
  private waiters: { test: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

  constructor(readonly cookie = '') {}

  async open(): Promise<Extract<ServerMessage, { t: 'welcome' }>> {
    this.ws = new (WebSocket as unknown as new (url: string, opts: unknown) => WebSocket)(`ws://${base}/ws`, { headers: { cookie: this.cookie } });
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const m = JSON.parse(e.data) as ServerMessage;
        if (m.t === 'ping') this.send({ t: 'pong', at: m.at });
        if (m.t === 'start') this.begin(m.match);
        if (m.t === 'snapshot' && this.match) this.match = restoreMatch(m.snapshot, { defs: ARENA_DEFS, shore: null });
        this.msgs.push(m);
        for (const w of [...this.waiters]) if (w.test(m)) (this.waiters.splice(this.waiters.indexOf(w), 1), w.resolve(m));
      } else this.frames.push(...decodeFrames(new Uint8Array(e.data as ArrayBuffer)));
    };
    await new Promise((r) => (this.ws.onopen = r));
    this.send({ t: 'hello', version: PROTOCOL_VERSION });
    return (await this.wait('welcome')) as Extract<ServerMessage, { t: 'welcome' }>;
  }

  private begin(s: MatchStart): void {
    this.start = s;
    this.frames = [];
    this.match = s.snapshot
      ? restoreMatch(s.snapshot, { defs: ARENA_DEFS, shore: null })
      : createMatch(buildWorld(s.map, ARENA_DEFS, null), s.map, s.seats.map((x) => ({ base: x.base, team: x.team })), s.seed, { difficulty: s.difficulty, handicap: s.handicap === true, gate: humanGate(s.seats) });
  }

  send(m: ClientMessage): void {
    this.ws.send(JSON.stringify(m));
  }

  wait<T extends ServerMessage['t']>(t: T, test: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, ms = 5000): Promise<Extract<ServerMessage, { t: T }>> {
    const seen = this.msgs.find((m) => m.t === t && test(m as Extract<ServerMessage, { t: T }>));
    if (seen) {
      this.msgs.splice(this.msgs.indexOf(seen), 1);
      return Promise.resolve(seen as Extract<ServerMessage, { t: T }>);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No ${t} message`)), ms);
      this.waiters.push({
        test: (m) => m.t === t && test(m as Extract<ServerMessage, { t: T }>),
        resolve: (m) => {
          clearTimeout(timer);
          this.msgs.splice(this.msgs.indexOf(m), 1);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }

  /** Plays every frame received so far; returns hashes at the checkpoints passed. */
  play(): Map<number, number> {
    const out = new Map<number, number>();
    const m = this.match!;
    for (const f of this.frames.splice(0)) {
      if (f.tick <= m.tick) continue;
      applyFrame(m, f);
      if (m.tick % HASH_EVERY === 0) out.set(m.tick, hashMatch(m));
    }
    return out;
  }

  async playUntil(tick: number): Promise<Map<number, number>> {
    const hashes = new Map<number, number>();
    const until = Date.now() + 10000;
    while (this.match!.tick < tick) {
      if (Date.now() > until) throw new Error(`Stuck at tick ${this.match!.tick}`);
      for (const [t, h] of this.play()) hashes.set(t, h);
      await new Promise((r) => setTimeout(r, 20));
    }
    return hashes;
  }

  close(): void {
    this.ws.close();
  }
}

async function signUp(name: string): Promise<string> {
  const r = await api('/api/auth/signup', { name, email: `${name.toLowerCase()}@example.com`, password: 'correct horse' });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.cookie;
}

describe('accounts', () => {
  it('take the owner from the deployment, sign players up and keep a session', async () => {
    const cookie = (await api('/api/auth/signin', { login: 'Robin', password: 'correct horse' })).cookie;
    const me = await api('/api/me', undefined, cookie);
    expect(me.json.user).toMatchObject({ name: 'Robin', role: 'owner', guest: false });
    // Signing up first no longer makes anyone the owner.
    const other = await signUp('Dana');
    expect((await api('/api/me', undefined, other)).json.user).toMatchObject({ name: 'Dana', role: 'player' });
    expect((await api('/api/auth/signup', { name: 'robin', email: 'x@example.com', password: 'longenough' })).status).toBe(409);
    expect((await api('/api/auth/signin', { login: 'Robin', password: 'wrong one' })).status).toBe(401);
    const back = await api('/api/auth/signin', { login: 'robin@example.com', password: 'correct horse' });
    expect(back.status).toBe(200);
    expect((await api('/api/admin/dashboard', undefined, back.cookie)).status).toBe(200);
    expect((await api('/api/admin/dashboard', undefined, other)).status).toBe(403);
  });

  it('ask for the password again before a ban, and log it', async () => {
    const owner = (await api('/api/auth/signin', { login: 'Robin', password: 'correct horse' })).cookie;
    const target = await signUp('Spammer');
    const id = ((await api('/api/me', undefined, target)).json.user as { id: string }).id;
    await new Promise((r) => setTimeout(r, 5));
    // A fresh sign-in counts as having entered the password; an old session does not.
    game.db.run('UPDATE sessions SET reauth_at = 0');
    expect((await api(`/api/admin/users/${id}/action`, { action: 'ban', reason: 'spam' }, owner)).status).toBe(428);
    expect((await api('/api/auth/reauth', { password: 'correct horse' }, owner)).status).toBe(200);
    expect((await api(`/api/admin/users/${id}/action`, { action: 'ban', reason: 'spam' }, owner)).status).toBe(200);
    expect((await api('/api/me', undefined, target)).json.user).toBeNull();
    const audit = await api('/api/admin/audit', undefined, owner);
    expect((audit.json.entries as { action: string; reason: string }[])[0]).toMatchObject({ action: 'user.ban', reason: 'spam' });
  });

  it('keep the owner in step with the deployment settings', async () => {
    const owner = { name: 'Robin', email: 'robin@example.com', password: 'correct horse' };
    expect(await game.accounts.ensureOwner(owner)).toBe('unchanged');
    // A new configured password replaces the old one and signs the owner out everywhere.
    const old = (await api('/api/auth/signin', { login: 'Robin', password: 'correct horse' })).cookie;
    expect(await game.accounts.ensureOwner({ ...owner, password: 'battery staple' })).toBe('updated');
    expect((await api('/api/me', undefined, old)).json.user).toBeNull();
    expect((await api('/api/auth/signin', { login: 'Robin', password: 'battery staple' })).status).toBe(200);
    // A password changed in the game stays while the configured one is the same.
    const id = game.accounts.byName('Robin')!.id;
    await game.accounts.setPassword(id, 'changed in game');
    expect(await game.accounts.ensureOwner({ ...owner, password: 'battery staple' })).toBe('unchanged');
    expect((await api('/api/auth/signin', { login: 'Robin', password: 'changed in game' })).status).toBe(200);
    await expect(game.accounts.ensureOwner({ ...owner, email: 'other@example.com', name: 'Dana' })).rejects.toThrow('belongs to another account');
    await game.accounts.setPassword(id, 'correct horse');
    // The sign-ins above count against this address's limit; later tests sign in afresh.
    (game.accounts as unknown as { signinLimit: Limiter }).signinLimit = new Limiter(0.2, 8);
  });
});

describe('online play', () => {
  it('runs a lobby, a lockstep match, chat, desync recovery and a reconnect', async () => {
    const pa = (await api('/api/auth/signin', { login: 'Robin', password: 'correct horse' })).cookie;
    const da = (await api('/api/auth/signin', { login: 'Dana', password: 'correct horse' })).cookie;
    const a = new Client(pa);
    const b = new Client(da);
    const robin = (await a.open()).you;
    expect(robin).toMatchObject({ name: 'Robin', guest: false });
    await b.open();

    // Robin makes a lobby: its other seat starts open, so Dana finds it in the list with room and joins.
    a.send({ t: 'create', mapId: 'arena2', visibility: 'open' });
    const made = await a.wait('lobby', (m) => !!m.lobby);
    expect(made.lobby!.slots.map((s) => s.kind)).toEqual(['human', 'open']);
    b.send({ t: 'lobbies', watch: true });
    await b.wait('lobbies', (m) => m.list.some((l) => l.id === made.lobby!.id && l.free === 1));
    b.send({ t: 'join', id: made.lobby!.id });
    await b.wait('lobby', (m) => m.lobby?.slots[1]?.user?.name === 'Dana');
    a.send({ t: 'start' });
    expect((await a.wait('error')).message).toMatch(/Dana/);
    b.send({ t: 'ready', ready: true });
    await a.wait('lobby', (m) => !!m.lobby?.slots[1]?.ready);

    // Chat: team messages stay on the team; whispers reach one player.
    a.send({ t: 'chat', channel: 'team', text: 'secret plan' });
    a.send({ t: 'chat', channel: 'all', text: 'good luck' });
    expect((await b.wait('chat', (m) => !m.message.system)).message.text).toBe('good luck');
    b.send({ t: 'chat', channel: 'whisper', to: robin.id, text: 'psst' });
    expect((await a.wait('chat', (m) => m.message.channel === 'whisper')).message).toMatchObject({ text: 'psst', to: { name: 'Robin' } });
    expect((await a.wait('chat', (m) => m.message.channel === 'team')).message.text).toBe('secret plan');

    a.send({ t: 'start' });
    const sa = await a.wait('start');
    await b.wait('start');
    expect(sa.match.seats.map((s) => s.name)).toEqual(['Robin', 'Dana']);
    expect(sa.match.you).toBe(0);
    a.send({ t: 'loaded' });
    b.send({ t: 'loaded' });

    // Robin launches a tank and drives; both clients play the server's frames to the same state. The bunker fades in
    // first, and the vehicles take their lifts up.
    await a.playUntil(HASH_EVERY);
    await b.playUntil(HASH_EVERY);
    a.ws.send(encodeCommand({ launch: 'tank' }));
    a.ws.send(encodeInput({ throttle: 1, turn: 1 }));
    b.ws.send(encodeCommand({ launch: 'jeep' }));
    b.ws.send(encodeInput({ throttle: 1, turn: 0, fire: true }));
    const ha = await a.playUntil(HASH_EVERY * 12);
    const hb = await b.playUntil(HASH_EVERY * 12);
    for (const [t, h] of ha) if (hb.has(t)) expect(hb.get(t), `tick ${t}`).toBe(h);
    expect(a.match!.players[0]!.vehicle?.kind).toBe('tank');
    expect(b.match!.players[1]!.vehicle?.kind).toBe('jeep');
    for (const [t, h] of ha) a.ws.send(encodeHash(t, h));
    for (const [t, h] of hb) b.ws.send(encodeHash(t, h));

    // A client that goes wrong is told so and handed the server's state.
    const t0 = b.match!.tick;
    const next = (Math.floor(t0 / HASH_EVERY) + 1) * HASH_EVERY;
    b.match!.players[1]!.vehicle!.x += 1;
    const bad = await b.playUntil(next);
    b.ws.send(encodeHash(next, bad.get(next)!));
    expect((await b.wait('desync')).tick).toBe(next);
    await b.wait('snapshot');
    const later = (Math.floor(b.match!.tick / HASH_EVERY) + 2) * HASH_EVERY;
    const ha2 = await a.playUntil(later);
    const hb2 = await b.playUntil(later);
    expect(hb2.get(later)).toBe(ha2.get(later));

    // Dana drops out and comes back: she gets the match as it stands and plays on in step.
    b.close();
    await a.wait('seats', (m) => m.seats.some((s) => !s.connected));
    const b2 = new Client(da);
    await b2.open();
    const back = await b2.wait('start');
    expect(back.match.snapshot).toBeTruthy();
    expect(back.match.you).toBe(1);
    const check = (Math.floor(b2.match!.tick / HASH_EVERY) + 2) * HASH_EVERY;
    const ha3 = await a.playUntil(check);
    const hb3 = await b2.playUntil(check);
    expect(hb3.get(check)).toBe(ha3.get(check));

    // The admin view lists the running game.
    const games = await api('/api/admin/games', undefined, pa);
    expect((games.json.lobbies as { game: { tick: number } | null }[])[0]!.game!.tick).toBeGreaterThan(0);
    a.close();
    b2.close();
  }, 30000);

  it('keeps online play to signed-in players', async () => {
    const visitor = new Client();
    const w = await visitor.open();
    expect(w.you.guest).toBe(true);
    for (const msg of [{ t: 'quick' }, { t: 'create', name: 'x', mapId: 'arena2', visibility: 'public' }, { t: 'chat', channel: 'all', text: 'hi' }] as const) {
      visitor.send(msg as ClientMessage);
      expect((await visitor.wait('error')).message).toBe('Sign in to play online');
    }
    visitor.send({ t: 'lobbies', watch: true });
    await visitor.wait('lobbies');
    visitor.close();
  }, 20000);

  it('plays a seat nobody took with the computer', async () => {
    (game.accounts as unknown as { signupLimit: Limiter }).signupLimit = new Limiter(1, 10);
    const h = new Client(await signUp('Solo'));
    await h.open();
    h.send({ t: 'create', mapId: 'arena2', visibility: 'open', teams: [1, 1] });
    const l = await h.wait('lobby', (m) => !!m.lobby);
    expect(l.lobby!.slots[1]).toMatchObject({ kind: 'open', team: 1 });
    h.send({ t: 'start' });
    const s = await h.wait('start');
    expect(s.match.seats).toHaveLength(2);
    expect(s.match.seats[1]).toMatchObject({ bot: true, team: 1 });
    h.send({ t: 'quitGame' });
    h.send({ t: 'leave' });
    h.close();
  }, 20000);

  it('plays quick matches against bots', async () => {
    (game.accounts as unknown as { signupLimit: Limiter }).signupLimit = new Limiter(1, 10);
    const g = new Client(await signUp('Quinn'));
    const w = await g.open();
    expect(w.you).toMatchObject({ name: 'Quinn', guest: false });
    g.send({ t: 'quick' });
    const l = await g.wait('lobby', (m) => !!m.lobby);
    expect(l.lobby!.slots.filter((s) => s.kind === 'bot')).toHaveLength(1);
    expect(l.lobby).toMatchObject({ visuals: 'modern', lighting: 'day' });
    // The host has everyone play in the modern view at night; nonsense falls back to day.
    g.send({ t: 'settings', visuals: 'modern', lighting: 'night' });
    await g.wait('lobby', (m) => m.lobby?.visuals === 'modern' && m.lobby.lighting === 'night');
    g.send({ t: 'settings', lighting: 'dusk' as 'day' });
    await g.wait('lobby', (m) => m.lobby?.lighting === 'day');
    g.send({ t: 'settings', lighting: 'night' });
    await g.wait('lobby', (m) => m.lobby?.lighting === 'night');
    g.send({ t: 'start' });
    const s = await g.wait('start');
    expect(s.match.seats[1]!.bot).toBe(true);
    expect(s.match).toMatchObject({ visuals: 'modern', lighting: 'night' });
    g.send({ t: 'loaded' });
    await g.playUntil(200);
    // The bot waits in its bunker until Quinn launches; its moves then arrive in the frames like anyone's.
    expect(g.match!.players[1]!.state).toBe('bunker');
    g.ws.send(encodeCommand({ launch: 'tank' }));
    await g.playUntil(g.match!.tick + 160);
    expect(g.match!.players[0]!.state).not.toBe('bunker');
    expect(g.match!.players[1]!.state).not.toBe('bunker');
    g.send({ t: 'quitGame' });
    g.send({ t: 'leave' });
    g.close();
  }, 20000);
});

describe('map library', () => {
  const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]).toString('base64');
  const named = (name: string, bases = 2) => ({ ...arenaMap(bases), name });
  const idOf = async (cookie: string) => ((await api('/api/me', undefined, cookie)).json.user as { id: string }).id;

  it('keeps maps with revisions, shares them by visibility and lets lobbies use them', async () => {
    // Every test signs up from 127.0.0.1; start this one with a fresh sign-up allowance.
    (game.accounts as unknown as { signupLimit: Limiter }).signupLimit = new Limiter(1, 10);
    const maker = await signUp('Mapper');
    const fan = await signUp('Fan');
    const makerId = await idOf(maker);
    const fanId = await idOf(fan);

    const made = await api('/api/maps', { map: named('Twin Peaks'), visibility: 'public', thumb: PNG }, maker);
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    const id = made.json.id as string;
    expect(id).toMatch(/^u-/);

    // Anyone, signed in or not, can list, open and see a picture of a public map; the server sets the author.
    const listed = await api('/api/maps?visibility=public&q=twin');
    expect(listed.json.maps).toEqual([expect.objectContaining({ id, name: 'Twin Peaks', author: 'Mapper', bases: 2, playable: true, hasThumb: true })]);
    const opened = await api(`/api/maps/${id}`);
    expect(opened.json.map).toMatchObject({ id, author: 'Mapper', authorId: makerId, visibility: 'public', revision: 1, version: 2 });
    const thumb = await fetch(`http://${base}/api/maps/${id}/thumb`);
    expect(thumb.headers.get('content-type')).toBe('image/png');

    // Saving from an old revision is a conflict; saving from the current one keeps the old one.
    expect((await api(`/api/maps/${id}`, { map: named('Twin Peaks II'), revision: 0 }, maker, 'PUT')).status).toBe(409);
    expect((await api(`/api/maps/${id}`, { map: named('Twin Peaks II'), revision: 1 }, fan, 'PUT')).status).toBe(403);
    const saved = await api(`/api/maps/${id}`, { map: named('Twin Peaks II'), visibility: 'public', revision: 1 }, maker, 'PUT');
    expect(saved.json.revision).toBe(2);
    expect((await api(`/api/maps/${id}/revisions`, undefined, maker)).json.revisions).toEqual([expect.objectContaining({ revision: 1 })]);
    expect(((await api(`/api/maps/${id}/revisions/1`, undefined, maker)).json.map as { name: string }).name).toBe('Twin Peaks');

    // A map with errors can be kept privately but not shared or played.
    const broken = named('Broken');
    broken.bases[0]!.flagSites = [];
    const refused = await api('/api/maps', { map: broken, visibility: 'public' }, maker);
    expect(refused.status).toBe(422);
    const draft = await api('/api/maps', { map: broken, visibility: 'private' }, maker);
    expect(draft.status).toBe(200);
    expect(game.maps.get(draft.json.id as string, makerId)).toBeNull();

    // Private maps are their author's alone; unlisted ones anyone with the id may open, but neither is listed.
    const secret = (await api('/api/maps', { map: named('Secret'), visibility: 'private' }, maker)).json.id as string;
    expect(game.maps.get(secret, makerId)?.name).toBe('Secret');
    expect(game.maps.get(secret, fanId)).toBeNull();
    expect((await api(`/api/maps/${secret}`, undefined, fan)).status).toBe(404);
    expect((await api(`/api/maps/${secret}/visibility`, { visibility: 'unlisted' }, maker)).status).toBe(200);
    expect(game.maps.get(secret, fanId)?.name).toBe('Secret');
    expect((await api('/api/maps?visibility=public&q=secret')).json.maps).toEqual([]);
    const mine = await api('/api/maps?mine=1', undefined, maker);
    expect((mine.json.maps as { name: string }[]).map((m) => m.name).sort()).toEqual(['Broken', 'Secret', 'Twin Peaks II']);

    // Likes count once per player, and not your own.
    expect((await api(`/api/maps/${id}/like`, { like: true }, fan)).json.likes).toBe(1);
    expect((await api(`/api/maps/${id}/like`, { like: true }, fan)).json.likes).toBe(1);
    expect((await api(`/api/maps/${id}/like`, { like: true }, maker)).status).toBe(400);
    expect((await api('/api/maps?visibility=public&sort=likes')).json.maps).toEqual([expect.objectContaining({ id, likes: 1 })]);
  });

  it('lets staff work through reports, hide, feature and limit maps, all in the audit log', async () => {
    const owner = (await api('/api/auth/signin', { login: 'Robin', password: 'correct horse' })).cookie;
    const maker = (await api('/api/auth/signin', { login: 'Mapper', password: 'correct horse' })).cookie;
    const fan = (await api('/api/auth/signin', { login: 'Fan', password: 'correct horse' })).cookie;
    const makerId = await idOf(maker);
    const id = ((await api('/api/maps?visibility=public&q=Twin')).json.maps as { id: string }[])[0]!.id;

    expect((await api(`/api/maps/${id}/report`, { reason: 'rude name' }, fan)).status).toBe(200);
    expect((await api('/api/admin/maps', undefined, fan)).status).toBe(403);
    const queue = await api('/api/admin/maps?filter=reported', undefined, owner);
    expect(queue.json.maps).toEqual([expect.objectContaining({ id, reports: 1 })]);
    expect((await api(`/api/admin/maps/${id}/reports`, undefined, owner)).json.reports).toEqual([expect.objectContaining({ reporter: 'Fan', reason: 'rude name' })]);

    expect((await api(`/api/admin/maps/${id}/action`, { action: 'feature' }, owner)).status).toBe(200);
    expect((await api('/api/maps?visibility=public&featured=1')).json.maps).toEqual([expect.objectContaining({ id, featured: true })]);
    expect((await api(`/api/admin/maps/${id}/action`, { action: 'hide' }, owner)).status).toBe(400);
    expect((await api(`/api/admin/maps/${id}/action`, { action: 'hide', reason: 'Offensive name' }, owner)).status).toBe(200);
    expect((await api('/api/admin/maps?filter=reported', undefined, owner)).json.maps).toEqual([]);
    expect((await api('/api/maps?visibility=public')).json.maps).toEqual([]);
    expect((await api(`/api/maps/${id}`, undefined, fan)).status).toBe(404);
    expect(game.maps.get(id, null)).toBeNull();
    // The author still sees it, with the reason, and cannot share it again.
    expect((await api(`/api/maps/${id}`, undefined, maker)).json.info).toMatchObject({ hidden: true, hiddenReason: 'Offensive name', featured: false });
    expect((await api(`/api/maps/${id}/visibility`, { visibility: 'public' }, maker)).status).toBe(403);

    // A per-account limit, then the site's name filter.
    expect((await api(`/api/admin/users/${makerId}/map-limit`, { max: 4 }, owner, 'PUT')).json.limit).toBe(4);
    expect((await api('/api/maps', { map: named('Fourth') }, maker)).status).toBe(200);
    expect((await api('/api/maps', { map: named('Fifth') }, maker)).status).toBe(403);
    expect((await api(`/api/admin/users/${makerId}/map-limit`, { max: null }, owner, 'PUT')).json.limit).toBe(50);
    game.settings.set({ mapNameFilter: ['grot'] });
    expect((await api('/api/maps', { map: named('Grot Island'), visibility: 'public' }, maker)).status).toBe(422);
    expect((await api('/api/maps', { map: named('Grot Island'), visibility: 'private' }, maker)).status).toBe(200);

    const audit = (await api('/api/admin/audit', undefined, owner)).json.entries as { action: string; target: string }[];
    expect(audit.map((e) => e.action).slice(0, 4)).toEqual(['map.limit', 'map.limit', 'map.hide', 'map.feature']);
  });
});

describe('friends and saved replays', () => {
  it('ask, accept, show who is where, invite to a lobby and let friends watch private games', async () => {
    (game.accounts as unknown as { signupLimit: Limiter }).signupLimit = new Limiter(1, 10);
    const ada = await signUp('Adaline');
    const bo = await signUp('Bosco');
    const cy = await signUp('Cyrus');
    const a = new Client(ada);
    const b = new Client(bo);
    await a.open();
    await b.open();
    expect((await api('/api/friends', { name: 'nobody' }, ada)).status).toBe(404);
    expect((await api('/api/friends', { name: 'Bosco' }, ada)).json.state).toBe('sent');
    expect((await b.wait('friends')).notice).toMatch(/Adaline wants to be friends/);
    expect((await api('/api/friends', undefined, bo)).json).toMatchObject({ incoming: ['Adaline'], friends: [] });
    expect((await api('/api/friends/Adaline/accept', {}, bo)).json.state).toBe('friends');
    await a.wait('friends');
    // Bo hosts a private lobby: Ada sees it but cannot join it unasked; Bo invites her.
    b.send({ t: 'create', name: 'Secret', mapId: 'arena2', visibility: 'private' });
    const lobby = (await b.wait('lobby', (m) => !!m.lobby)).lobby!;
    const list = (await api('/api/friends', undefined, ada)).json as { friends: { name: string; status: string; lobbyName?: string; joinId?: string }[] };
    expect(list.friends).toEqual([{ name: 'Bosco', status: 'lobby', lobbyName: 'Secret' }]);
    expect((await api('/api/friends/Cyrus/invite', {}, bo)).status).toBe(404);
    expect((await api('/api/friends/Adaline/invite', {}, bo)).status).toBe(200);
    expect(await a.wait('invite')).toMatchObject({ from: 'Bosco', lobbyName: 'Secret', code: lobby.code });
    // Once Bo plays, Ada (a friend) may watch the private game; Cy may not.
    b.send({ t: 'slot', slot: 1, kind: 'bot' });
    await b.wait('lobby', (m) => m.lobby!.slots[1]!.kind === 'bot');
    b.send({ t: 'start' });
    const start = await b.wait('start');
    const c = new Client(cy);
    await c.open();
    c.send({ t: 'spectate', gameId: start.match.gameId });
    expect((await c.wait('error')).message).toBe('That game is private');
    a.send({ t: 'spectate', gameId: start.match.gameId });
    expect((await a.wait('start')).match.you).toBeNull();
    // Unfriending ends it both ways.
    expect((await api('/api/friends/Bosco', {}, ada, 'DELETE')).status).toBe(200);
    expect((await api('/api/friends', undefined, bo)).json).toMatchObject({ friends: [], incoming: [], outgoing: [] });
    b.send({ t: 'quitGame' });
    for (const x of [a, b, c]) x.close();
  }, 20000);

  it('save replays to an account, up to the site limit', async () => {
    const { ReplayRecorder } = await import('@rfw/net');
    const map = arenaMap(2);
    const seats = [{ base: 0, team: 0, name: 'Deedee' }, { base: 1, team: 1, name: 'Bot' }];
    const m = createMatch(buildWorld(map, ARENA_DEFS, null), map, seats, 5, { difficulty: 5 });
    const rec = new ReplayRecorder({ at: 1000, mode: 'training', mapId: 'arena2', mapName: 'Arena', map, seed: 5, difficulty: 5, seats });
    for (let i = 0; i < 100; i++) rec.frame(m, [1, 0], []);
    const replay = rec.finish(null);
    (game.accounts as unknown as { signupLimit: Limiter }).signupLimit = new Limiter(1, 10);
    const dee = await signUp('Deedee');
    expect((await api('/api/replays', replay)).status).toBe(401);
    expect((await api('/api/replays', { v: 1, seats: [] }, dee)).status).toBe(400);
    const saved = (await api('/api/replays', replay, dee)).json.replay as { id: string; players: string[] };
    expect(saved.players).toEqual(['Deedee', 'Bot']);
    // The same match twice is kept once.
    expect(((await api('/api/replays', replay, dee)).json.replay as { id: string }).id).toBe(saved.id);
    expect(((await api('/api/replays', undefined, dee)).json.replays as unknown[]).length).toBe(1);
    expect((await api(`/api/replays/${saved.id}`, undefined, dee)).json.replay).toEqual(replay);
    expect((await api(`/api/replays/${saved.id}`, undefined, await signUp('Evelyn'))).status).toBe(404);
    game.settings.set({ replayLimit: 1 });
    expect((await api('/api/replays', { ...replay, at: 2000 }, dee)).status).toBe(409);
    game.settings.set({ replayLimit: 30 });
    expect((await api(`/api/replays/${saved.id}`, {}, dee, 'DELETE')).status).toBe(200);
    expect(((await api('/api/replays', undefined, dee)).json.replays as unknown[]).length).toBe(0);
  }, 20000);
});
