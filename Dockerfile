FROM node:26-alpine3.23 AS base

WORKDIR /usr/app
COPY ./package.json \
     ./package-lock.json \
     ./next.config.mjs \
     ./prisma.config.ts \
     ./tsconfig.json \
     ./reset.d.ts \
     ./tailwind.config.js \
     ./postcss.config.js ./
COPY ./scripts ./scripts
COPY ./prisma ./prisma

RUN apk add --no-cache openssl && \
    ( for i in 1 2 3 4 5; do \
        npm ci --ignore-scripts --fetch-retries=5 --fetch-timeout=600000 && exit 0; \
        echo "npm ci failed (attempt $i), retrying in 10s..."; sleep 10; \
      done; exit 1 )

COPY ./src ./src
COPY ./messages ./messages

# Prisma 7 generates the client into ./src/generated/prisma instead of
# node_modules, so this has to run after the source tree is in place.
RUN npx prisma generate

ENV NEXT_TELEMETRY_DISABLED=1

COPY scripts/build.env .env
RUN npm run build

# Isolated install of the Prisma CLI (matching the build's version) with its
# full dependency tree AND engine binaries. The base stage installs with
# --ignore-scripts (the repo's postinstall runs migrate deploy, which can't run
# at build time), so @prisma/engines never downloads the schema engine that
# `migrate deploy` needs; and the CLI has deps outside the @prisma scope (e.g.
# effect). This stage produces a complete, self-contained CLI for the runtime.
FROM node:26-alpine3.23 AS prisma-cli
WORKDIR /opt/prisma-cli
ENV CHECKPOINT_DISABLE=1
RUN apk add --no-cache openssl
COPY --from=base /usr/app/node_modules/prisma/package.json ./_prisma.json
RUN PV="$(node -p "require('./_prisma.json').version")" && \
    rm -f ./_prisma.json && \
    npm init -y >/dev/null 2>&1 && \
    ( for i in 1 2 3 4 5; do \
        npm install --no-audit --no-fund \
          --fetch-retries=5 --fetch-timeout=600000 "prisma@${PV}" && exit 0; \
        echo "prisma install attempt $i failed, retrying in 10s..."; sleep 10; \
      done; exit 1 )

FROM node:26-alpine3.23 AS runner

EXPOSE 3000/tcp
WORKDIR /usr/app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Listen on all interfaces inside the container.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN apk add --no-cache openssl

# Next.js standalone server: a minimal node_modules traced from the build,
# plus the static assets and public files it serves.
COPY --from=base /usr/app/.next/standalone ./
COPY --from=base /usr/app/.next/static ./.next/static
COPY ./public ./public
COPY --from=base /usr/app/prisma ./prisma
# Prisma config (used by `migrate deploy` to resolve the database connection,
# which Prisma 7 reads from prisma.config.ts instead of the schema).
COPY ./prisma.config.ts ./

# Prisma CLI for `migrate deploy` on startup (complete closure). The Rust-free
# Prisma 7 client (generated into the bundled app code) and its runtime deps
# (@prisma/client, @prisma/adapter-pg, pg) are already traced into the Next.js
# standalone output above, so no separate client/engine copy is needed.
COPY --from=prisma-cli /opt/prisma-cli/node_modules ./node_modules

COPY ./scripts ./scripts

ENTRYPOINT ["/bin/sh", "/usr/app/scripts/container-entrypoint.sh"]
