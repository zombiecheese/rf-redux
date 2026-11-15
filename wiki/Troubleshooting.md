# Troubleshooting

## Installing and running

**`docker compose up` says the owner settings are missing.** Copy `env.example` to `.env` beside `docker-compose.yml` and set `RF_OWNER_NAME`, `RF_OWNER_EMAIL` and `RF_OWNER_PASSWORD`.

**The site does not answer on port 8080.** Run `docker compose ps` and wait for `web` to show as healthy. `docker compose logs -f` shows why if it never does. Check nothing else is using the port, or set `RF_PORT` to another one.

**`npm install` or the game fails with Node errors.** The game needs Node.js 22. Check with `node --version`.

**The Docker build fails with certificate errors.** Behind a proxy that inspects TLS, pass its CA bundle to the build:

```sh
docker build --secret id=ca_cert,src=/path/to/ca-bundle.crt -t rf-redux .
docker compose up -d --no-build
```

**I forgot the owner password.** Put a new `RF_OWNER_PASSWORD` in `.env` and run `docker compose up -d`.

## Playing

**No sound.** Browsers only allow sound after a key press or a tap, so press a key on the splash. **V** turns sound off and on, and **Options > Sound and Music > Volume** has the volumes.

**A key does nothing.** **H** lists the keys in use. A key may have been rebound under **Options > Controls > Vehicle Keys**. While the chat line, a text box, a dialog or the menu is open, the vehicle takes no keys.

**I cannot pause online.** That is by design: an online match is shared, so no player can stop it.

**Split Screen is missing, or the Level Editor is greyed out.** Both are desktop only. Phones and tablets play solo, and the editor needs a desktop browser with a mouse and keyboard.

**The game stays in the classic view.** The modern view needs WebGL. Turn on hardware acceleration in the browser's settings. Online, the host picks the view for everyone.

**There is no THERMAL button.** The thermal camera is only there in the modern view during a night match. Pick Night on Match Setup, or ask the host to.

**The editor's Modern and Night previews are greyed out.** They need WebGL. Turn on hardware acceleration in the browser's settings, or use Classic.

**My phone shows "turn your device sideways".** The game plays in landscape. The match waits until you turn it.

**The picture looks soft.** Add `?scale=integer` to the address to scale by whole numbers only, or change the scaling under **Options**.

**My base went out and I still had tanks.** A base with no jeeps left is out, because only a jeep can capture a flag. See [[Game Rules]].

## Online

**"Sign in" is asked for everything.** Online play needs an account. Training and Split Screen do not.

**I cannot sign up.** The site's owner may have set sign-ups to invite-only or closed. Ask them for an invite code.

**I forgot my password.** The site sends no email. Ask one of its admins for a one-time reset code.

**I was told to reload.** The site was updated while your page was open. Reload to get the new version.

**An old replay will not play.** Replays recorded before a change to the game's rules cannot be played back, and the game says so.

## Still stuck?

Open an issue on the [issue tracker](https://github.com/zombiecheese/rf-redux/issues) with what you did, what happened, and your browser and its version.
