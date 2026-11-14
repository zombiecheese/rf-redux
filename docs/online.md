# Online play and the admin panel

Online play runs on the game server (`packages/server`), which is also what serves the game, so a deployed site
([deploy.md](deploy.md)) has it already. Matches run on the same deterministic sim as solo play; the server only
orders everyone's controls and checks that every machine stays in step.

## Playing online

Online play needs an account: lobbies, quick match, joining by code or invite link, spectating and chat all ask
you to sign in (or sign up) first. Solo and two-player games on one keyboard need no account, and the leaderboards
are open to everyone. Everything is under **Online** in the main menu, which opens with the title screen:

| Item | Does |
| --- | --- |
| Back to the Lobby | Brings back the lobby while you are in one |
| Quick Match | Joins an open lobby that has room, or makes one |
| Find a Game | The lobby browser: open lobbies with their map, host, seats and state, a search box, and Join or Watch on each |
| Host a Game | Makes a lobby you own: its name, who can join, the team layout, and the map from the map picker (search, group, player count, and a preview of the picked map) |
| Join with a Code | Joins a private lobby by its code; an invite link (`/?join=CODE`) does the same |
| Friends | Your friends and what they are doing, friend requests, invites to lobbies, and asking someone by name |
| Leaderboards | The ladder and the fastest solo wins per map |
| Profile, Sign In, Create an Account, Sign Out | Your account, which online play needs |

Moderators, admins and the owner also see **Admin Panel** in the main menu.

**Lobbies.** A lobby has one seat per base on its map (up to four), each a card in its base's colour (Brown, Green,
Blue, Red) with its team, who sits there, a bot's skill and whether the player is ready; chat is beside the seats,
and the lobby's code and invite link above them. The Menu button puts the lobby aside for the main menu (Back to the
Lobby brings it back). The owner picks the map from the map picker (the built-in maps by level, with the 3- and
4-base ones under "3 & 4 players", their own library maps under "My maps" and public ones under "Shared", with a
preview of the picked map; the lobby shows the same preview above its settings), the team layout (free for all, 2v2,
2v1, 2v1v1 and so on, or any team A–D per seat), the difficulty, and whether the lobby is open (listed in the
browser) or private (code or invite link only). Each seat is open, closed, a player, or a bot with its own
difficulty 1–9; any base nobody takes is played by a bot. "Handicap for the smaller side" helps a team
with fewer players than the biggest in two ways, and is off by default. It starts with its vehicle counts scaled up
to match, rounded up (one base against two gets double, one against three triple; unlimited stays unlimited), and its
flag must be captured more than once: three times for one base against two, five against three. After a capture that
is not the last, the flag goes back to its base, hidden again if a flag building still stands. In bot-only tests one base against two won 6 matches
in 30 with the handicap and none without, so the single base is still the underdog. Bots stay in their bunkers until every human
player has launched a vehicle, so nobody is overrun while still picking one on the lift screen; once the first has
launched, the others get 45 seconds before the bots set off anyway. The owner can also
have everyone see the match the same way: Visuals classic or modern for all, and Lighting day or night for all (the
modern view); left at "Each player's choice", each player's own Options apply. A browser without WebGL stays classic. When every player is ready the owner starts the match.
Others can watch as spectators. When the match ends, the results show and the lobby is ready for a rematch.

**Base colours.** Each base has its own colours, shown beside its seat in the lobby and used for its vehicles,
buildings, soldiers, flag, radar dot, name tag and chat lines: Base 1 Brown and Base 2 Green, as in the original,
then Base 3 Blue and Base 4 Red. The original only drew two sides, so bases 3 and 4 are palette swaps of Brown's
sprites made in the client (`packages/client/src/paint.ts`): only the pixels where Brown's and Green's sprites
differ and Brown's is a brown change hue, so lights, glass, tracks and shading stay as the original drew them.

**Winning.** As in solo play, a base is out when an enemy jeep takes its flag home or it has no jeeps left (none in the bunker and none on the map). Home
is the jeep's own base or the base of any teammate still in the match. A player whose base is out stays in the match
as a watcher: their view starts on a teammate who is still playing (or anyone still in), the turn keys, fire, 1–4 or
P1–P4 switch between the players still in, and they can still chat. The
last team standing wins. If the last bases go out on the same tick the match is a draw. A match stops after two hours:
the team with the most jeeps left (in its bunkers and on the map) then wins, and level counts make it a draw.

A base nobody plays is on nobody's side: its towers stay silent and its men treat every vehicle as an enemy. A prison
holds the men of the next base round that is played by another team.

Replays recorded before a change to the sim's rules do not play back (`REPLAY_VERSION` in
`packages/net/src/replay.ts`); the game says so when one is opened.

**Chat.** Every lobby and running game has chat. In a game, T opens the chat line, Tab switches between everyone,
your team and one player, Enter sends and Esc closes. While it is open the vehicle takes no keys; Enter is still a
fire key when it is closed, as offline. Tab with the chat line closed shows the scoreboard. On a phone or tablet the
Chat and Scores buttons at the top do the same; the chat line opens at the top of the screen, clear of the keyboard,
and tapping its label picks who it goes to.
Right-click a message to report it or block its sender; moderators can mute players. A spectator presses 1–4 (on a
touch screen, P1–P4 at the top) to follow a player, or ← / → to step through them.

**No pausing.** An online match is shared, so no player can pause it: P and the touch pause
button do nothing online (the menu and dialogs open over the match while it plays on, and the menu has no Pause). Only the server stops the
clock: an admin's pause, or a friends' game waiting for a dropped player (below).

**Dropped connections.** The client reconnects by itself. A dropped player's seat is held for a minute (a friends'
game pauses meanwhile). After that, or straight away if they quit, a bot at the match difficulty plays the seat; a
player who is connected, on the lift screen or not, never has their seat played by a bot. A player who comes back before the end takes the seat over again from the match as it stands.

**Friends.** Online > Friends lists your friends, online ones first, each with what they are doing: online, in a
lobby (with its name), playing or watching a game. Ask someone by their player name; once they accept you are
friends both ways, and either can remove the other. From the list you can join a friend's open lobby, watch their
game (a private game too, which strangers cannot watch), or, while you are in a lobby, invite a friend to it: the
invite pops up for them (or, during a match, waits in their Friends list for ten minutes) and joining it uses the
lobby's code, so it works for private lobbies. A player who has blocked you in chat never sees your requests or
invites. An account can have up to 200 friends and requests.

**Saved replays.** Every match is recorded in the browser (Replays in the main menu; see the README). Signed in,
the ☁ button on a replay saves it to your account, where it can be watched or saved as a file from any browser
you sign in on. The site setting "Replays one account keeps" caps how many (30 by default; 0 turns it off).

**Stats.** A signed-in player's profile keeps their settings (names, key bindings, difficulty, volume and music, visuals and lighting, picture and CRT look, Swap Sides,
the last map picked) and
online stats: wins, losses, flags captured, vehicles lost and the vehicle they launch most. The ladder is an Elo
rating starting at 1000, counted from matches with at least two signed-in players on opposing teams. A solo best
time counts only after the server has replayed the run in the sim and seen the player win. Runs are recorded in
Training on a built-in map with the computer playing every other base for itself (two, three or four bases) and no handicap.

## Accounts

Sign-up takes a name, an email address and a password. Passwords are hashed with scrypt and sessions are
cookies. There is no email delivery: a player who forgets their password asks an admin for a one-time reset code.
The site owner chooses whether sign-ups are open, invite-only (an admin makes invite codes) or closed. A visitor who
is not signed in can see the lobby list but not join, make or watch a game, or chat.

The **owner** account is set up by the deployment from `RF_OWNER_NAME`, `RF_OWNER_EMAIL` and `RF_OWNER_PASSWORD`;
signing up never makes anyone the owner ([deploy.md](deploy.md#the-owner-account-and-the-admin-panel)).

## The admin panel

The admin panel opens over the game from **Admin Panel** in the main menu, which only moderators, admins and the
owner see; `/admin` (or `/admin/<section>`) opens the game with it once signed in. It has the same look as the menus
and lobby. Each section shows only to the roles that can use it, and the server checks the role on every call. Bans, deletions and role
changes ask for your password again, and every action goes into the audit log.

| Section | Role | What it covers |
| --- | --- | --- |
| Dashboard | moderator | Players online (signed in and not), lobbies, games, accounts, sign-ups over the last two weeks, server CPU, memory and tick lag, desyncs, open reports |
| Players | moderator | Search and profiles; warn, mute. Admins also suspend, ban, rename, verify, sign out everywhere and make reset codes; the owner changes roles and deletes accounts |
| Lobbies & games | moderator | Watch, kick, pause, resume, mute a lobby, make it private, broadcast to it. Admins also end games and close lobbies, and broadcast to the whole site |
| Chat | moderator | The chat log with each message's context, and the report queue |
| Maps | moderator | Shared map moderation ([level-editor.md](level-editor.md)) |
| Site | admin | Sign-ups (open, invite, closed), a maintenance notice with countdown, message of the day, news, featured maps, default difficulty, the most games at once and connections per address, chat retention, word filter and slow mode, map limits and words refused in map names, replays one account keeps |
| Audit log | owner | Every staff action, who did it and when |

Roles rank player < moderator < admin < owner; each can do everything the roles below it can.

## How it works

The server runs every match in **deterministic lockstep**. Each 16 ms tick it sends every client a frame holding
all players' controls and bunker commands for that tick; each client steps its own copy of the sim with them.
Clients send their controls when they change. Bots run on the server, and their controls go out in the frames like
anyone else's.

Every 30 ticks each client sends a hash of its match state. The server keeps its own copy of the match, and a
client whose hash differs gets a snapshot of the server's state to carry on from. Both states are saved in
`/data/desyncs/` for debugging. The same snapshots let a reconnecting player or a spectator join a running match.

Lobbies, chat, sign-in state and match start and end are JSON messages on the WebSocket at `/ws`; the per-tick
traffic is small binary messages (`packages/net/src/frames.ts`). Everything else is a JSON HTTP API under `/api`
(`/api/admin/*` for the panel). Connections, messages, sign-ins, sign-ups, chat, map saves and solo submissions are
rate-limited.

A client with an older `PROTOCOL_VERSION` (`packages/net/src/messages.ts`) is told to reload. Bump it whenever a
message, the frame format or the sim changes in a way an older client would get wrong.

## Running it locally

```sh
npm run build -w @rfw/server && npm start   # the game server on port 8080, data in data/
npm run dev                                 # the client on port 5173, passing /api and /ws to port 8080
```

Open http://localhost:5173 in two browsers (or a normal and a private window) to play against yourself.

## Code

| File | Does |
| --- | --- |
| `packages/sim/src/snapshot.ts` | Snapshots, restore and the state hash |
| `packages/net/src/frames.ts` | The binary lockstep messages and input packing |
| `packages/net/src/messages.ts` | The JSON messages, roles, lobby seats and `PROTOCOL_VERSION` |
| `packages/net/src/solo.ts` | Solo run logs and their replay |
| `packages/net/src/replay.ts` | Match replays: the recorder and the player (with seeking) |
| `packages/server/src/server.ts` | Puts the server together: HTTP, WebSocket, static files |
| `packages/server/src/hub.ts`, `ws.ts` | WebSocket connections, pings and limits |
| `packages/server/src/lobbies.ts` | Lobbies, seats, teams, quick match and who gets which chat |
| `packages/server/src/room.ts` | A running match: ticks, frames, bots, hashes, snapshots, reconnects |
| `packages/server/src/accounts.ts` | Sign-up, sign-in, sessions, reset codes |
| `packages/server/src/chat.ts` | Chat checks, logs, blocks, mutes and reports |
| `packages/server/src/stats.ts` | Profiles, stats, the ladder and solo leaderboards |
| `packages/server/src/friends.ts` | Friends, requests, presence and lobby invites (`/api/friends`) |
| `packages/server/src/replays.ts` | Replays saved to accounts (`/api/replays`), gzipped in SQLite |
| `packages/server/src/admin.ts`, `audit.ts`, `settings.ts` | The admin API, audit log and site settings |
| `packages/server/src/db.ts` | SQLite (`node:sqlite`) and each feature's migrations |
| `packages/client/src/online/` | The online dialogs, lobby browser, map picker, lobby window, friends, connection and in-game chat and scoreboard |
| `packages/client/src/admin/panel.ts` | The admin panel, opened over the game (`admin.html` only sends `/admin` there) |
