# Deployment

This page puts the game on a server so other people can play. The game ships as one container image, `ghcr.io/zombiecheese/rf-redux`, which holds the server, the game and everything it needs. Day-to-day running of a site is on [[Server Administration]].

## What you need

- A Linux host with [Docker](https://docs.docker.com/get-docker/) and Compose v2. The image is built for `linux/amd64`.
- Port 8080 open, or ports 80 and 443 and a DNS name if you want HTTPS.

## Deploy a release

1. On the host, download `docker-compose.yml`, `env.example` and `Caddyfile` from the latest release on the [Releases page](https://github.com/zombiecheese/rf-redux/releases) into one folder. That `docker-compose.yml` is pinned to the release's version.
2. Copy `env.example` to `.env` and set the owner's account:

   ```sh
   RF_OWNER_NAME=YourName
   RF_OWNER_EMAIL=you@example.com
   RF_OWNER_PASSWORD=a-long-password
   ```

   Compose refuses to start without these. Keep `.env` readable only by you.
3. Start the stack:

   ```sh
   docker compose up -d
   ```
4. When `docker compose ps` shows `web` as healthy, open `http://your-host:8080` and sign in with the owner account (**Online**, then **Sign In**).

## Deploy from the source

Use this to run a version that has not been released, or your own changes.

```sh
git clone https://github.com/zombiecheese/rf-redux.git
cd rf-redux
cp .env.example .env
```

Fill in `.env` as above, then:

```sh
docker compose up -d --build
```

## HTTPS

The stack includes an optional Caddy service that gets a free certificate from Let's Encrypt. Point a DNS name at the host, open ports 80 and 443, and add to `.env`:

```sh
RF_DOMAIN=returnfire.example.com
RF_TRUST_PROXY=1
RF_PORT=127.0.0.1:8080
```

Then start the stack with the `https` profile:

```sh
docker compose --profile https up -d
```

`RF_TRUST_PROXY=1` tells the server to take players' addresses from Caddy, which bans and rate limits rely on. Only set it when all traffic comes through Caddy. `RF_PORT=127.0.0.1:8080` stops port 8080 being published to the network.

## Who can reach it

The site serves the original game's two-player map layouts. Whether to open it to the internet is the owner's call. To keep it to a known group, put it behind a VPN, a firewall allow-list or Caddy's `basic_auth` rather than opening the port to everyone. You can also set sign-ups to invite-only or closed in the admin panel.

## Updating

| Deployed from | Command |
| --- | --- |
| A release | Download the new release's `docker-compose.yml` over the old one, then `docker compose pull` and `docker compose up -d` |
| The source | `git pull`, then `docker compose up -d --build` |

Setting `RF_VERSION=latest` in `.env` makes a release deployment follow the newest release each time you pull.

## Settings

All settings go in `.env`.

| Setting | Default | What it does |
| --- | --- | --- |
| `RF_OWNER_NAME`, `RF_OWNER_EMAIL`, `RF_OWNER_PASSWORD` | required | The site owner's account |
| `RF_PORT` | `8080` | The host port (or `address:port`) the game is published on |
| `RF_VERSION` | the release's version | Which image version to run |
| `RF_DOMAIN` | `localhost` | The site's DNS name, for HTTPS |
| `RF_TRUST_PROXY` | `0` | `1` behind Caddy or another reverse proxy |
| `RF_BACKUP_HOURS` | `24` | Hours between database backups, `0` for none |
| `RF_BACKUP_KEEP` | `7` | How many backups are kept |
| `RF_METRICS_TOKEN` | none | Turns on `/metrics` for monitoring |

## Without Docker

On a host with Node.js 22:

```sh
npm ci
npm run build
npm start
```

This serves the same site on port 8080 and keeps its data in `data/`. The same settings apply without the `RF_` prefix (`OWNER_NAME`, `OWNER_EMAIL`, `OWNER_PASSWORD` and so on).

The full reference is [docs/deploy.md](https://github.com/zombiecheese/rf-redux/blob/main/docs/deploy.md) in the repository.
