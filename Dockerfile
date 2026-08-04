# ─────────────────────────────────────────────────────────────
# a7smart — один контейнер віддає і API, і зібраний React.
# Один процес, один роутер Traefik, мінімум пам'яті: сервер живе
# поруч із n8n, flowise та a7cms на 1 GB RAM.
# ─────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS base
WORKDIR /app

# ── Build ──
FROM base AS build

# Спершу лише маніфести → кеш шару залежностей не злітає від зміни коду.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY . .
RUN npm run build --workspace web
RUN npm run build --workspace server

# ── Runtime-залежності ──
# Окремий шар: прод-дерево без dev-пакетів (tsx, vite, typescript…).
FROM base AS deps
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server --include-workspace-root

# ── Runtime ──
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=deps  /app/node_modules        ./node_modules
COPY --from=build /app/server/dist         ./server/dist
COPY --from=build /app/server/migrations   ./server/migrations
# Статику кладемо в ./web — саме звідти її бере serveStatic (server/src/index.ts).
COPY --from=build /app/web/dist            ./web

# Контейнер портів не публікує: Traefik ходить у нього по внутрішній мережі.
EXPOSE 3000

USER node

# Міграції застосовуються керовано з локальної машини (npm run db:migrate),
# як і в a7cms — Neon спільний, сервер не навантажується.
CMD ["node", "server/dist/index.js"]
