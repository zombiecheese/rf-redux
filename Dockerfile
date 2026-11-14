# The game server image: the built client, with the art pack the game runs on, plus the Node game server
# (multiplayer, accounts, admin). It is the whole game: nothing is imported at run time (see docs/deploy.md).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/sim/package.json packages/sim/
COPY packages/net/package.json packages/net/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
# The optional ca_cert build secret is for building behind a TLS-intercepting proxy (see docs/deploy.md).
RUN --mount=type=secret,id=ca_cert,required=false \
    if [ -f /run/secrets/ca_cert ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_cert; fi; \
    npm ci
COPY packages packages
# The project's art pack, built into the client. Besides the project's own art it holds two things
# from the original: its measurements and its two-player map layouts (assets/art/README.md).
COPY assets/art/pack assets/art/pack
RUN npm run typecheck && npm test && npm run build
# The SoundFont for Options > Instruments > Sampled (GeneralUser GS, tools/soundfont/), checked by its SHA-256.
COPY tools/soundfont tools/soundfont
RUN --mount=type=secret,id=ca_cert,required=false \
    if [ -f /run/secrets/ca_cert ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_cert; fi; \
    node tools/soundfont/fetch.mjs /app/extras/music/soundfont.sf2 && \
    cp tools/soundfont/GeneralUser-GS-LICENSE.txt /app/extras/music/

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 CLIENT_DIR=/app/client ASSETS_DIR=/assets/generated DATA_DIR=/data
WORKDIR /app
# The server is one bundled file (packages/server/vite.config.ts), so the image needs no node_modules.
COPY --from=build /app/packages/client/dist client
COPY --from=build /app/packages/server/dist server
COPY --from=build /app/extras /assets/generated
RUN mkdir -p /data && chown node:node /data
USER node
# The database, its backups and desync reports.
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
# node:sqlite still prints an experimental warning on Node 22.
CMD ["node", "--disable-warning=ExperimentalWarning", "server/main.js"]
