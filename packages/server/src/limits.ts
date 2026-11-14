// Rate limits: token buckets by key (an IP address, a user, a connection). Each bucket refills at rate tokens a
// second up to burst; take() spends one and says whether there was one to spend.

export class Limiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(private readonly rate: number, private readonly burst: number) {}

  take(key: string, cost = 1, now = Date.now()): boolean {
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.burst, at: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) / 1000) * this.rate);
    b.at = now;
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    return true;
  }

  /** Forgets buckets that have refilled, so the map does not grow without end. */
  sweep(now = Date.now()): void {
    for (const [k, b] of this.buckets) if (b.tokens + ((now - b.at) / 1000) * this.rate >= this.burst) this.buckets.delete(k);
  }
}

/** Counts open things (connections) per key against a cap. */
export class Counter {
  private readonly counts = new Map<string, number>();

  count(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  add(key: string): void {
    this.counts.set(key, this.count(key) + 1);
  }

  remove(key: string): void {
    const n = this.count(key) - 1;
    if (n > 0) this.counts.set(key, n);
    else this.counts.delete(key);
  }
}
