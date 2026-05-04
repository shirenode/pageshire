# syntax=docker/dockerfile:1.7

# ---------- Stage 1: install deps ----------
FROM node:20-alpine AS deps
WORKDIR /app

# Copy workspace manifests first to leverage layer cache
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspaces --include-workspace-root

# ---------- Stage 2: runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Non-root user
RUN addgroup -S app && adduser -S app -G app

# Copy installed node_modules and source
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json ./
COPY apps/api ./apps/api
COPY apps/web ./apps/web

USER app

EXPOSE 3000

# Healthcheck hits the API's /healthz endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "apps/api/src/server.js"]
