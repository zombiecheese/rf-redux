// Fetches the modern renderer's code (and three.js with it) once, as early as the modern view is known to be wanted:
// at start-up for a player whose view is Modern, in a lobby whose host picked it, and as a match starts. Until it
// is here a modern match shows the link-up screen (hud.ts drawLinkUp), never the classic picture.

type RendererModule = typeof import('./renderer.js');

let pending: Promise<RendererModule | null> | null = null;
let loaded: RendererModule | null = null;
let failed = false;

/** Starts fetching the modern renderer, if it is not on its way already. Settles with null if it cannot load. */
export function loadModern(): Promise<RendererModule | null> {
  pending ??= import('./renderer.js').then(
    (mod) => (loaded = mod),
    (err: unknown) => {
      console.error('The modern view could not load:', err);
      failed = true;
      return null;
    },
  );
  return pending;
}

/** The modern renderer's module once it has loaded, else null. */
export function modernLoaded(): RendererModule | null {
  return loaded;
}

/** Whether the modern renderer failed to load (the match then falls back to the classic picture). */
export function modernFailed(): boolean {
  return failed;
}

/** Marks the modern view as unusable here, for a renderer that could not start (no WebGL context, say). */
export function giveUpModern(): void {
  failed = true;
}
