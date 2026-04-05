# ─── Stage 1: Install dependencies ──────────────────────────────────
FROM oven/bun:1.3 AS deps

WORKDIR /app

# Copy workspace root files
COPY package.json bun.lock turbo.json ./

# Copy workspace package.json files
COPY apps/mcp/package.json apps/mcp/package.json
COPY packages/lib/package.json packages/lib/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/hooks/package.json packages/hooks/package.json
COPY packages/memory-graph/package.json packages/memory-graph/package.json
COPY packages/markitdown/package.json packages/markitdown/package.json

# Install all dependencies
RUN bun install --frozen-lockfile

# ─── Stage 2: Build ────────────────────────────────────────────────
FROM oven/bun:1.3 AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build workspace packages and MCP server
RUN cd packages/lib && bun run build 2>/dev/null || true
RUN cd apps/mcp && bun run build

# ─── Stage 3: Production runtime ───────────────────────────────────
FROM node:20-slim AS runtime

WORKDIR /app

# Copy built output and node_modules
COPY --from=builder /app/apps/mcp/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/mcp/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3002

EXPOSE 3002

CMD ["node", "dist/index.js"]
