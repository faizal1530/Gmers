# Satu proses Node melayani situs (apps/web/dist) dan WebSocket (apps/server).
# Bangun:  docker build -t gmers .
# Jalan:   docker run -p 8787:8787 -v gmers-data:/data -e ADMIN_TOKEN=... -e HASH_SALT=... gmers

FROM node:22-slim AS build
ENV CI=true
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/game-engine/package.json packages/game-engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY scripts/package.json scripts/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
RUN pnpm --filter @gmers/web build

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/game-engine/package.json packages/game-engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY scripts/package.json scripts/
RUN pnpm install --frozen-lockfile --prod --filter @gmers/server...
COPY packages/game-engine/src packages/game-engine/src
COPY apps/server/tsconfig.json apps/server/
COPY apps/server/src apps/server/src
COPY --from=build /app/apps/web/dist apps/web/dist
# Folder data (log langkah JSONL dan events.csv); pasang Volume di /data.
# Volume Railway dipasang milik root, jadi kontainer mulai sebagai root, memperbaiki
# pemilik /data, lalu server berjalan sebagai pengguna non-root `node` (setpriv).
RUN mkdir -p /data && chown -R node:node /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "chown -R node:node /data && exec setpriv --reuid=node --regid=node --init-groups apps/server/node_modules/.bin/tsx apps/server/src/main.ts"]
