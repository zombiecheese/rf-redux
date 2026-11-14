// The optional extras folder (/generated/, docs/assets.md): a SoundFont, replacement MIDI files, an older pack's
// sprites. The server lists what it holds at /generated/extras.json, so the game asks only for files that are there
// and a site with none makes no failed requests. A server with no list is taken to have no extras.

let listed: Promise<Set<string>> | null = null;

/** The paths under /generated/ that exist, such as music/soundfont.sf2. Asked for once a visit. */
export function extras(): Promise<Set<string>> {
  listed ??= (async () => {
    try {
      const res = await fetch('/generated/extras.json');
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return new Set<string>();
      const body = (await res.json()) as { files?: unknown };
      return new Set(Array.isArray(body.files) ? body.files.filter((f): f is string => typeof f === 'string') : []);
    } catch {
      return new Set<string>();
    }
  })();
  return listed;
}

/** For tests: forget the list. */
export function forgetExtras(): void {
  listed = null;
}
