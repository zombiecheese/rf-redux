// Starts the game server (server.ts) with configuration from the environment:
//   PORT            port to listen on (8080)
//   CLIENT_DIR      the built client (packages/client/dist)
//   ASSETS_DIR      optional extras served at /generated/, such as music/soundfont.sf2 (assets/generated)
//   DATA_DIR        the database, backups and desync reports (data/)
//   OWNER_NAME      the site owner's account, made at start if missing (see Accounts.ensureOwner): player name,
//   OWNER_EMAIL     email and password. OWNER_PASSWORD_FILE reads the password from a file (a Docker secret)
//   OWNER_PASSWORD  instead. Without them the server runs with no owner, so nobody can open the admin panel.
//   TRUST_PROXY     1 behind a reverse proxy (Caddy): take client addresses from X-Forwarded-For
//   SECURE_COOKIES  1 to mark the sign-in cookie Secure (on by default with TRUST_PROXY)
//   BACKUP_HOURS    hours between database backups into DATA_DIR/backups (24; 0 for none)
//   BACKUP_KEEP     backups kept (7)
//   METRICS_TOKEN   enables /metrics (Prometheus text) for requests with "Authorization: Bearer <token>"

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './server.js';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const env = process.env;
const PORT = Number(env.PORT ?? 8080);
const trustProxy = env.TRUST_PROXY === '1';

const game = createGameServer({
  clientDir: env.CLIENT_DIR ?? join(ROOT, 'packages/client/dist'),
  assetsDir: env.ASSETS_DIR ?? join(ROOT, 'assets/generated'),
  dataDir: env.DATA_DIR ?? join(ROOT, 'data'),
  trustProxy,
  secureCookies: env.SECURE_COOKIES ? env.SECURE_COOKIES === '1' : trustProxy,
  backupHours: Number(env.BACKUP_HOURS ?? 24),
  backupKeep: Number(env.BACKUP_KEEP ?? 7),
  metricsToken: env.METRICS_TOKEN || undefined,
});

/** The owner account from the environment, or null when none is set; a half-set owner stops the server. */
function ownerConfig(): { name: string; email: string; password: string } | null {
  const name = env.OWNER_NAME?.trim() ?? '';
  const email = env.OWNER_EMAIL?.trim() ?? '';
  const password = env.OWNER_PASSWORD_FILE ? readFileSync(env.OWNER_PASSWORD_FILE, 'utf8').replace(/\r?\n$/, '') : env.OWNER_PASSWORD ?? '';
  if (!name && !email && !password) return null;
  if (!name || !email || !password) throw new Error('Set all of OWNER_NAME, OWNER_EMAIL and OWNER_PASSWORD (or OWNER_PASSWORD_FILE)');
  if (password === 'change-me-please') throw new Error('Choose your own OWNER_PASSWORD; the one in .env.example is only a placeholder');
  return { name, email, password };
}

try {
  const owner = ownerConfig();
  if (owner) {
    const done = await game.accounts.ensureOwner(owner);
    console.log(`Owner account ${owner.name} <${owner.email}>: ${done}`);
  } else console.warn('No owner account: set OWNER_NAME, OWNER_EMAIL and OWNER_PASSWORD to manage the site');
} catch (err) {
  console.error(`Owner account: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

game.server.listen(PORT, () => console.log(`Return Fire: Redux on :${PORT}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    setTimeout(() => process.exit(0), 3000).unref();
    void game.close().then(() => process.exit(0));
  });
}
