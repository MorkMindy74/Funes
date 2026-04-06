# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

This is a **polyglot monorepo** (TypeScript, Python, Go) managed by Turbo + Bun at the top level, with independent build systems for non-TS ecosystems.

### Applications (`apps/`)
- **`api/`** - Hono-based REST API (primary backend)
- **`web/`** - Next.js web application
- **`mcp/`** - Model Context Protocol server (Hono)
- **`browser-extension/`** - Browser extension
- **`raycast-extension/`** - Raycast integration
- **`memory-graph-playground/`** - Graph visualization playground
- **`docs/`** - Documentation site

### Packages (`packages/`) — TypeScript
- **`tools/`** - AI SDK + OpenAI tool definitions for Supermemory client (`@supermemory/tools`)
- **`ai-sdk/`** - AI SDK middleware wrapper (`@supermemory/ai-sdk`)
- **`memory-graph/`** - Knowledge graph operations (`@supermemory/memory-graph`)
- **`validation/`** - Shared Zod schemas for API request/response validation
- **`hooks/`** - React hooks (auth, onboarding, etc.)
- **`ui/`** - Shared Radix-based UI components
- **`lib/`** - Shared utilities
- **`markitdown/`** - TypeScript port of Microsoft MarkItDown (PDF, DOCX, XLSX, PPTX, EPUB, HTML, CSV)

### Packages (`packages/`) — Python (build: `hatchling`, env: `uv`)
- **`openai-sdk-python/`** - OpenAI function-calling tools for Supermemory
- **`pipecat-sdk-python/`** - Pipecat voice agent integration
- **`agent-framework-python/`** - Agent framework bindings

### Standalone Ecosystems
- **`beads/`** — Go project (distributed graph issue tracker for AI agents, built on Dolt). Has its own `go.mod`, `Makefile`, and test suite. **Do not run Biome/Bun/Turbo on this directory.**
- **`deer-flow/`** — Python project (event-driven orchestration engine for semantic DAGs, LangGraph-based). Has its own `pyproject.toml`, `docker-compose`, and `Makefile`. **Do not run Biome/Bun/Turbo on this directory.**
- **`skills/`** — Skill definitions for agent orchestration

## Development Commands

### Root Level (Turbo Monorepo — TypeScript only)
- `bun run dev` - Start all TS applications in development mode
- `bun run build` - Build all TS applications
- `bun run check-types` - Run TypeScript checks across all TS apps/packages
- `bun run format-lint` - Format and lint TS code using Biome

### Web Application (`apps/web/`)
- `bun run dev` - Start Next.js development server
- `bun run build` - Build Next.js application
- `bun run lint` - Run Next.js linting

### Python Packages (`packages/*-python/`)
- Build: `uv build` or `hatch build`
- Test: `uv run pytest` or `python -m pytest`
- These are NOT managed by Turbo/Bun — they have independent toolchains

### Beads (`beads/`)
- Build: `go build ./cmd/bd/`
- Test: `go test ./...`

### Deer-Flow (`deer-flow/`)
- Dev: `make dev` or `docker-compose up`
- See `deer-flow/README.md` for full setup

## Architecture Overview

### Core Technology Stack
- **Languages**: TypeScript (primary), Python (SDK packages, deer-flow), Go (beads)
- **TS Runtime**: Node.js / Bun
- **Web Framework**: Next.js (frontend), Hono (API & MCP)
- **Package Manager**: Bun (TS), uv/hatch (Python), go modules (Go)
- **Monorepo**: Turbo (TS packages only)
- **Authentication**: Better Auth
- **Monitoring**: Sentry

### API Application (`apps/api/` — Primary Backend)
The API serves as the core backend with these key features:

**Key API Routes**
- `/v3/documents` - CRUD operations for documents/memories
- `/v3/search` - Semantic search across indexed content
- `/v3/connections` - External service integrations (Google Drive, Notion, OneDrive)
- `/v3/settings` - Organization and user settings
- `/v3/analytics` - Usage analytics and reporting
- `/api/auth/*` - Authentication endpoints

### Web Application
Next.js application providing the main user interface.

### Content Processing Pipeline
All content goes through the `IngestContentWorkflow` which handles:
- Content type detection and extraction (via `packages/markitdown`)
- AI-powered summarization and automatic tagging
- Local embedding generation (Xenova/transformers, no external API)
- Knowledge graph entity/relationship extraction (Ollama)
- Chunking for semantic search optimization
- Space relationship management

## Key Libraries & Dependencies

### Shared TS Dependencies
- `better-auth` - Authentication system with organization support
- `drizzle-orm` - Database ORM (PostgreSQL)
- `zod` - Schema validation
- `hono` - Web framework (API & MCP)
- `@sentry/*` - Error monitoring
- `turbo` - Monorepo build system

### Web-Specific
- `next` - React framework
- `@radix-ui/*` - UI components
- `@tanstack/react-query` - Data fetching
- `recharts` - Analytics visualization

### Tools Package (`packages/tools`)
- `ai@^5` - Vercel AI SDK v5 (note: `apps/api` uses `ai@^6`)
- `supermemory@^3` - Supermemory client SDK
- `@mastra/core` - Mastra agent framework integration

## Code Quality & Standards

### Linting & Formatting
- **Biome** used for linting and formatting across the TS monorepo
- Run `bun run format-lint` to format and lint all TS code
- Configuration in `biome.json` at repository root
- **Scope**: Biome covers `apps/` and `packages/` (TS only). Do NOT run Biome on `beads/` or `deer-flow/`.

### TypeScript
- Strict TypeScript configuration with `@total-typescript/tsconfig`
- Type checking with `bun run check-types`
- CI checks: `bunx turbo run check-types --filter='@supermemory/ai-sdk' --filter='@supermemory/memory-graph' --filter='@repo/api' --filter='@supermemory/tools'`

### Database Management
- Drizzle ORM with schema located in shared packages
- Database migrations handled through Drizzle Kit
- Schema types automatically generated and shared

## Security & Best Practices

### Authentication
- Better Auth handles user authentication and organization management
- API key authentication for external access
- Role-based access control within organizations

### Data Handling
- Content hashing to prevent duplicate processing
- Secure handling of external service credentials
- Automatic content type detection and validation

### Self-Hosted Deployment
- Docker Compose for self-hosted deployment (`docker-compose.yml`)
- PostgreSQL + Redis + Ollama + LanceDB as local infrastructure
- Local embedding generation (no external API dependency)
- Environment-specific configuration via `.env`
