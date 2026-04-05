# ─── Stage 1: Install dependencies ──────────────────────────────────
FROM oven/bun:1.3 AS deps

WORKDIR /app

# Copy workspace root files
COPY package.json bun.lock turbo.json ./

# Copy all workspace package.json files needed
COPY apps/web/package.json apps/web/package.json
COPY packages/lib/package.json packages/lib/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY packages/markitdown/package.json packages/markitdown/package.json
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

# Set build-time environment variables
ENV NEXT_PUBLIC_BACKEND_URL=DOCKER_BACKEND_URL_PLACEHOLDER
ENV NEXT_TELEMETRY_DISABLED=1

# Build workspace packages and Next.js app
RUN cd packages/validation && bun run build 2>/dev/null || true
RUN cd packages/lib && bun run build 2>/dev/null || true
RUN cd apps/web && bun run build

# ─── Stage 3: Production runtime ───────────────────────────────────
FROM node:20-slim AS runtime

WORKDIR /app

# Install curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Copy Next.js standalone output
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000 || exit 1

# Use the Next.js standalone server
CMD ["node", "apps/web/server.js"]
