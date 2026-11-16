# Deploying with Docker

The game runs as a small container stack defined in `docker-compose.yml`:

| Service | Image | What it does |
| --- | --- | --- |
| `web` | `Dockerfile` (Node) | The whole game: the server, the built client and the art pack it runs on (sprites, tables, sounds, pictures and maps), plus online play (lockstep matches, bots), accounts, lobbies, chat, leaderboards and the admin panel at `/admin`. Port 8080, with a `/healthz` check that turns healthy once the art pack is loaded and the database is open. Its data (a SQLite database, backups and desync reports) lives in the `data` volume. |
| `caddy` | `caddy:2-alpine` | Optional (`--profile https`): HTTPS on ports 80 and 443 with an automatic certificate for `RF_DOMAIN`, proxying the site and its WebSocket to `web`. |

The `web` image is complete in itself: nothing is imported when it starts, and it needs no copy of the original game. Its art pack includes two things from the original: its measurements (model shapes and number tables) and its 104 two-player map layouts.

There are two ways to run it: from the [published image](#deploying-from-a-release) of a release, which needs no source checkout and no build, or [from a checkout](#running-it-from-a-checkout), which builds the image on the host.

## Deploying from a release

Every release on GitHub (see [Releasing](#releasing)) pushes the image to the GitHub Container Registry as `ghcr.io/zombiecheese/rf-redux:<version>`, also tagged with its minor version (`0.2`) and `latest`, and attaches the files a host needs to run it. A new package on the registry starts out private even though the repository is public; the owner can make it public in the package's settings, and then step 1 is not needed.

1. While the package is private, sign in to the registry on the host with a GitHub [personal access token (classic)](https://github.com/settings/tokens) that has the `read:packages` scope, from an account that can see the repository:

   ```sh
   echo <token> | docker login ghcr.io -u <github-user> --password-stdin
   ```
2. Download `docker-compose.yml`, `env.example` and `Caddyfile` from the release's assets into one folder (or use `docker-compose.images.yml` from a checkout of the release tag, with `-f docker-compose.images.yml`). The release's `docker-compose.yml` is pinned to that version.
3. Copy `env.example` to `.env` and fill it in as below: the `RF_OWNER_*` settings are the owner's account.
4. Start the stack:

   ```sh
   docker compose up -d
   ```

To move to a newer release, download its `docker-compose.yml` over the old one (or set `RF_VERSION` in `.env`, for example `RF_VERSION=0.8.1`; `RF_VERSION=latest` follows the newest release), then `docker compose pull && docker compose up -d`. Everything else on this page, from HTTPS to backups, works the same way.

## Running it from a checkout

1. Clone this repository on the host.
2. Copy `.env.example` to `.env` beside `docker-compose.yml` and fill it in: `RF_OWNER_NAME`, `RF_OWNER_EMAIL` and `RF_OWNER_PASSWORD` are the site owner's account (see below). Compose refuses to start without the owner settings.
3. Start the stack:

   ```sh
   docker compose up -d --build
   ```
4. Open http://localhost:8080 (or the port set by `RF_PORT`) and sign in with the owner account (Online, then Sign In).

Online play, accounts and the admin panel are described in [online.md](online.md).

## The owner account and the admin panel

The site **owner** comes from the deployment, not from signing up: on start the server makes the account named by `RF_OWNER_NAME`, `RF_OWNER_EMAIL` and `RF_OWNER_PASSWORD` if no account has that email, and otherwise gives that account the owner role and name. Nobody becomes owner by signing up. The owner can make other players moderators or admins in the admin panel: Admin Panel in the game's main menu, which only moderators, admins and the owner see, or `/admin`, which opens the game with the panel once signed in.

The password in `.env` is set when the account is made. Change it in the game as you like; to reset it (a forgotten password), put a new `RF_OWNER_PASSWORD` in `.env` and run `docker compose up -d`, which sets it and signs the owner out everywhere. The server never prints the password. `.env` is git-ignored and kept out of images; keep it readable only by you. Without Docker, set `OWNER_NAME`, `OWNER_EMAIL` and `OWNER_PASSWORD` (or `OWNER_PASSWORD_FILE`, a file holding it, such as a Docker secret).

The admin panel covers players (search, warn, mute, suspend, ban, reset codes, roles), running games and lobbies (watch, end, kick, broadcast), chat moderation and reports, site settings (sign-ups open / invite-only / closed, chat filter, limits, message of the day, news, maintenance notice, featured maps) and an audit log. Bans, deletions and role changes ask for your password again.

There is no email delivery. A player who forgets their password gets a one-time reset code from an admin (Players, then Reset code).

## Public site with HTTPS

The `caddy` service puts the game on HTTPS with a free certificate from Let's Encrypt. Point a DNS name at the host, open ports 80 and 443, and add to `.env`:

```sh
RF_DOMAIN=returnfire.example.com
RF_TRUST_PROXY=1          # take players' addresses from Caddy (for bans and rate limits)
RF_PORT=127.0.0.1:8080    # stop publishing port 8080 to the network; Caddy reaches web directly
```

Then start the stack with the `https` profile:

```sh
docker compose --profile https up -d --build
```

Only set `RF_TRUST_PROXY=1` when all traffic comes through Caddy, or players could fake their address. Sign-in cookies are marked Secure when it is on. The site serves the original's map layouts; to keep it to a known group, use Caddy's `basic_auth`, a VPN or a firewall allow-list.

## Data and backups

The database is `/data/returnfire.db` in the `data` volume. The server copies it to `/data/backups/returnfire-<time>.db` every `RF_BACKUP_HOURS` hours (24 by default) and keeps the newest `RF_BACKUP_KEEP` (7). To take a copy off the host:

```sh
docker compose cp web:/data/backups ./backups
```

To restore one: `docker compose stop web`, copy the backup over `/data/returnfire.db` (for example with `docker compose cp ./backups/returnfire-<time>.db web:/data/returnfire.db`), then `docker compose start web`. `docker compose down -v` deletes the `data` volume, so it deletes every account.

When two players' games disagree (a desync, which should not happen), the server repairs the game from its own copy and saves both states in `/data/desyncs/` for debugging.

## Monitoring

`/healthz` returns `{"ok":true,...}` when the game data and database are ready. Set `RF_METRICS_TOKEN` to enable `/metrics` (Prometheus text: connections, lobbies, games, tick lag, desyncs, accounts, open reports, memory) for requests with `Authorization: Bearer <token>`. The admin dashboard shows the same figures.

## Settings

| Variable | Default | Used by |
| --- | --- | --- |
| `RF_PORT` | `8080` | Compose: host port (or `address:port`) for the game |
| `RF_VERSION` | the release's version (`latest` in `docker-compose.images.yml`) | Compose with published images: which image version to run |
| `RF_OWNER_NAME` | required | `web` (`OWNER_NAME`): the owner's player name |
| `RF_OWNER_EMAIL` | required | `web` (`OWNER_EMAIL`): the owner's email, which picks the account |
| `RF_OWNER_PASSWORD` | required | `web` (`OWNER_PASSWORD`, or `OWNER_PASSWORD_FILE` without Compose): set on the first start and whenever it changes |
| `RF_TRUST_PROXY` | `0` | `web` (`TRUST_PROXY`): `1` behind Caddy or another reverse proxy; also marks cookies Secure |
| `RF_BACKUP_HOURS` | `24` | `web` (`BACKUP_HOURS`): hours between database backups, `0` for none |
| `RF_BACKUP_KEEP` | `7` | `web` (`BACKUP_KEEP`): backups kept |
| `RF_METRICS_TOKEN` | (none) | `web` (`METRICS_TOKEN`): enables `/metrics` |
| `RF_DOMAIN` | `localhost` | `caddy`: the site's DNS name |
| `PORT` | `8080` | `web`: listening port inside the container |
| `CLIENT_DIR` | `/app/client` | `web`: built client |
| `ASSETS_DIR` | `/assets/generated` | `web`: an optional folder of extras served at `/generated/`, such as `music/soundfont.sf2` ([music.md](music.md)). The image already holds GeneralUser GS there for Options > Sound and Music > Instruments; a folder mounted over it replaces it, so put a SoundFont in yours if you want Sampled |
| `DATA_DIR` | `/data` | `web`: database, backups and desync reports |
| `SECURE_COOKIES` | as `TRUST_PROXY` | `web`: `1` or `0` to force the Secure flag on the sign-in cookie |

## Releasing

Releases are cut from `main` by pushing a version tag. `.github/workflows/release.yml` then checks that the tag matches the `version` in every `package.json` and has a section in `CHANGELOG.md`, builds the image, pushes it to the registry and publishes the GitHub release with that section as its notes.

1. Move the `[Unreleased]` notes in `CHANGELOG.md` under a new version heading and set that version in `package.json` and each `packages/*/package.json` (`npm version <version> --no-git-tag-version --workspaces --include-workspace-root`), plus the `@rfw/sim` and `@rfw/net` versions the other packages depend on, then run `npm install --package-lock-only` so the lockfile matches. Do this in a pull request.
2. Once it is merged, tag `main` and push the tag:

   ```sh
   git tag v0.8.1 && git push origin v0.8.1
   ```

   Publishing a release for a new tag on the repository's Releases page does the same: the workflow fills in its title, notes and files.

The image is built from the same `.dockerignore`d context as CI, and the release attaches only the compose file, `env.example` and `Caddyfile`. The image holds the art pack, with the original's measurements and map layouts. It is built for `linux/amd64`.

## Building behind a TLS-intercepting proxy

If `npm ci` fails with certificate errors during the build, pass your proxy's CA bundle as the optional `ca_cert` build secret:

```sh
docker build --secret id=ca_cert,src=/path/to/ca-bundle.crt -t rf-redux .
docker compose up -d --no-build
```

## Day-to-day commands

| Task | Command |
| --- | --- |
| Logs | `docker compose logs -f` |
| Update a checkout to a new version | `git pull && docker compose up -d --build` |
| Update a release deployment | `docker compose pull && docker compose up -d` |
| Back up the database | `docker compose cp web:/data/backups ./backups` |
| Stop | `docker compose down` (`-v` also deletes every account) |

## Without Docker

`npm ci && npm run build && npm start` serves the same thing on port 8080, with the art pack built into the client (see [assets.md](assets.md)) and keeping its data in `data/`. The same environment variables apply, without the `RF_` prefix.
