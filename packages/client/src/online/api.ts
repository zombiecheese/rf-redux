// The server's JSON API (packages/server). Errors come back as ApiError with the server's message; 428 means an
// admin action needs the password again.

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function api<T = Record<string, unknown>>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'The server cannot be reached');
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? `The server answered ${res.status}`);
  return json;
}

/** Whether this page is served by the game server (the Vite dev server alone has no API). */
let available: Promise<boolean> | null = null;
export function serverAvailable(): Promise<boolean> {
  available ??= fetch('/api/site').then((r) => r.ok && (r.headers.get('content-type') ?? '').includes('json')).catch(() => false);
  return available;
}
