# Server Administration

This page is for whoever runs a site. Setting one up is on [[Deployment]].

## The owner account

The owner comes from the deployment, never from signing up. When the server starts it makes the account named by `RF_OWNER_NAME`, `RF_OWNER_EMAIL` and `RF_OWNER_PASSWORD`, or gives the owner role to the account that already has that email.

To reset a forgotten owner password, put a new `RF_OWNER_PASSWORD` in `.env` and run `docker compose up -d`. That sets the password and signs the owner out everywhere.

## Roles

Roles rank player, moderator, admin, owner. Each can do everything the roles below it can. The owner makes moderators and admins in the admin panel.

## The admin panel

**Admin Panel** is in the game's main menu for moderators, admins and the owner. The address `/admin` opens it too, once you are signed in.

| Section | Who | What it covers |
| --- | --- | --- |
| Dashboard | moderator | Players online, lobbies, games, accounts, sign-ups, server load, open reports |
| Players | moderator | Search and profiles; warn and mute. Admins also suspend, ban, rename, sign out everywhere and make reset codes. The owner changes roles and deletes accounts |
| Lobbies & games | moderator | Watch, kick, pause, resume, mute a lobby, make it private, broadcast to it. Admins also end games, close lobbies and broadcast to the whole site |
| Chat | moderator | The chat log with each message's context, and the report queue |
| Maps | moderator | Moderating shared maps |
| Site | admin | Sign-ups (open, invite-only or closed), maintenance notice, message of the day, news, featured maps, default difficulty, limits, chat filter and slow mode |
| Audit log | owner | Every staff action, who did it and when |

Bans, deletions and role changes ask for your password again.

## Forgotten passwords

The server sends no email. A player who forgets their password asks an admin, who makes a one-time reset code under **Players > Reset code**.

## Backups

The database is `/data/returnfire.db` in the `data` volume. The server copies it to `/data/backups/` every 24 hours and keeps the newest seven (`RF_BACKUP_HOURS` and `RF_BACKUP_KEEP` change this).

Take the backups off the host:

```sh
docker compose cp web:/data/backups ./backups
```

Restore one:

```sh
docker compose stop web
docker compose cp ./backups/returnfire-<time>.db web:/data/returnfire.db
docker compose start web
```

`docker compose down -v` deletes the `data` volume, and with it every account, map and replay.

## Monitoring

- `/healthz` answers `{"ok":true,...}` when the game is ready.
- Set `RF_METRICS_TOKEN` to turn on `/metrics` (Prometheus text) for requests that send `Authorization: Bearer <token>`.
- `docker compose logs -f` follows the server's log.

## Day-to-day commands

| Task | Command |
| --- | --- |
| Logs | `docker compose logs -f` |
| Update a release deployment | `docker compose pull`, then `docker compose up -d` |
| Back up the database | `docker compose cp web:/data/backups ./backups` |
| Stop | `docker compose down` |
