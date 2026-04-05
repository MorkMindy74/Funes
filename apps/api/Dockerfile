# ─── Stage 1: Install dependencies ──────────────────────────────────
FROM oven/bun:1.3 AS deps

WORKDIR /app

# Copy workspace root files
COPY package.json bun.lock turbo.json ./

# Copy workspace package.json files for dependency resolution
COPY apps/api/package.json apps/api/package.json
COPY packages/markitdown/package.json packages/markitdown/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY packages/lib/package.json packages/lib/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/hooks/package.json packages/hooks/package.json
COPY packages/memory-graph/package.json packages/memory-graph/package.json

# Install all dependencies
RUN bun install --frozen-lockfile

# ─── Stage 2: Build ────────────────────────────────────────────────
FROM oven/bun:1.3 AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build workspace packages first, then the API
RUN cd packages/validation && bun run build 2>/dev/null || true
RUN cd packages/markitdown && bun run build 2>/dev/null || true
RUN cd apps/api && bun run build

# ─── Stage 3: Production runtime ───────────────────────────────────
FROM node:20-slim AS runtime

WORKDIR /app

# Install curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Copy built output and node_modules
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules 2>/dev/null || true
COPY --from=builder /app/packages ./packages

# Copy drizzle config and schema source for drizzle-kit push at startup
COPY --from=builder /app/apps/api/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/apps/api/src/db/schema.ts ./src/db/schema.ts
COPY --from=builder /app/apps/api/package.json ./package.json

# Copy entrypoint script
COPY apps/api/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Install drizzle-kit and tsx for schema push at startup
RUN npm install -g drizzle-kit tsx

# Create data directories
RUN mkdir -p /data/uploads /data/lancedb

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/data
ENV LANCEDB_DIR=/data/lancedb
ENV UPLOADS_DIR=/data/uploads

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
