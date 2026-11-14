// Deterministic random numbers for the shared sim. Every client and the server seed it the same way per
// match, so a draw (a flag site, a rubble variant) comes out identically everywhere. Integer only.

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0 || 0x2545f491;
  }

  /** Next 32-bit value (xorshift32). */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x | 0;
    return x >>> 0;
  }

  /** The state as it stands, without drawing from it. */
  peek(): number {
    return this.state;
  }

  /** An integer in [0, n). */
  below(n: number): number {
    return n <= 1 ? 0 : this.next() % n;
  }
}

/**
 * The original's random numbers: the Microsoft C runtime's rand(), and sub_41d3d0 to scale it to [0, n). Used
 * where the sim must draw exactly what the original drew, such as the scenery offsets.
 */
export class MsvcRand {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  rand(): number {
    this.state = (Math.imul(this.state, 0x343fd) + 0x269ec3) >>> 0;
    return (this.state >>> 16) & 0x7fff;
  }

  /** sub_41d3d0: an integer in [0, n). */
  below(n: number): number {
    return Math.imul(this.rand() << 1, n) >>> 16;
  }
}
