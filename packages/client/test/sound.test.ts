import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sound } from '../src/sound.js';

/** Just enough of Web Audio for the mixer: a context that starts suspended, as a browser leaves one made too early. */
class FakeContext {
  static made: FakeContext[] = [];
  state: 'suspended' | 'running' = 'suspended';
  destination = {};
  resumed = 0;
  constructor() {
    FakeContext.made.push(this);
  }
  createGain() {
    return { gain: { value: 0 }, connect: (n: unknown) => n };
  }
  async decodeAudioData() {
    return {};
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  resume() {
    this.resumed++;
    this.state = 'running';
    return Promise.resolve();
  }
}

let fetches = 0;
let failing = false;

beforeEach(() => {
  FakeContext.made = [];
  fetches = 0;
  failing = false;
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('fetch', async () => {
    fetches++;
    if (failing) throw new Error('offline');
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('sound effects audio', () => {
  it('starts a context the browser left suspended on a later key press or tap', async () => {
    const sound = new Sound();
    await sound.unlock();
    const ctx = FakeContext.made[0]!;
    expect(ctx.state).toBe('suspended');
    await sound.unlock();
    expect(ctx.state).toBe('running');
    expect(FakeContext.made).toHaveLength(1);
  });

  it('leaves a paused game silent until it goes on', async () => {
    const sound = new Sound();
    await sound.unlock();
    const ctx = FakeContext.made[0]!;
    sound.hold(true);
    await sound.unlock();
    expect(ctx.state).toBe('suspended');
    sound.hold(false);
    expect(ctx.state).toBe('running');
  });

  it('tries sounds that failed to load again later, not on every key', async () => {
    vi.useFakeTimers();
    const sound = new Sound();
    failing = true;
    await sound.unlock();
    const first = fetches;
    expect(first).toBeGreaterThan(0);
    await sound.unlock();
    expect(fetches).toBe(first);
    failing = false;
    vi.advanceTimersByTime(11_000);
    await sound.unlock();
    // A sound that fails is asked for in both packs (the art pack's, then the asset pack's); one that loads, once.
    expect(fetches).toBe(first + first / 2);
    // All loaded: nothing more is fetched.
    vi.advanceTimersByTime(60_000);
    await sound.unlock();
    expect(fetches).toBe(first + first / 2);
  });
});
