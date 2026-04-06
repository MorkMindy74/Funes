<p align="center">
  <img src="https://raw.githubusercontent.com/MorkMindy74/Funes/main/apps/web/public/funes-banner.png" alt="Funes — Memory engine for the AI era" width="700" />
</p>p>

<h1 align="center">Funes</h1>h1>

<p align="center">
  <em>"His memory, sir, is like a garbage heap."</em>em><br/>
    <sub>— Jorge Luis Borges, <a href="https://it.wikipedia.org/wiki/Funes,_o_della_memoria"><em>Funes, His Memory</em>em></a>a> (1942)</sub>sub>
</p>p>

<p align="center">
  <strong>The memory and context engine for AI. Impossibly fast. Impossibly thorough.</strong>strong><br/>
    <sub>Like Ireneo Funes, who forgot nothing — your AI will forget nothing either.</sub>sub>
</p>p>

<p align="center">
  <a href="https://github.com/MorkMindy74/Funes/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"/></a>a>
    <a href="https://github.com/MorkMindy74/Funes/commits/main"><img src="https://img.shields.io/github/last-commit/MorkMindy74/Funes" alt="Last Commit"/></a>a>
      <a href="https://github.com/MorkMindy74/Funes/actions"><img src="https://img.shields.io/github/actions/workflow/status/MorkMindy74/Funes/ci.yml?branch=main&label=CI" alt="CI Status"/></a>a>
        <img src="https://img.shields.io/badge/security-hardened-green" alt="Security Hardened"/>
          <img src="https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript" alt="TypeScript"/>
            <img src="https://img.shields.io/badge/built%20with-Claude%20Opus%204.6-blueviolet?logo=anthropic" alt="Built with Claude"/>
</p>p>

<p align="center">
  <a href="#-quick-start">Quick Start</a>a> ·
    <a href="#-whats-new">What's New</a>a> ·
      <a href="#️-architecture">Architecture</a>a> ·
        <a href="#-self-hosting">Self-Hosting</a>a> ·
          <a href="#-tribute">Tribute</a>a>
</p>p>

---

## 🧠 What is Funes?

Funes is a **production-grade memory and context layer** for AI agents and applications. It automatically extracts facts from conversations, builds persistent user profiles, resolves contradictions, handles temporal forgetting, and delivers the right context at exactly the right moment.

**Your AI forgets everything between conversations. Funes fixes that.**

| Capability | What it does |
|---|---|
| 🧠 **Memory Engine** | Extracts facts, tracks updates, resolves contradictions, auto-forgets expired info |
| 👤 **User Profiles** | Auto-maintained static facts + dynamic context. One call, ~50ms |
| 🔍 **Hybrid Search** | RAG + Memory in a single query — knowledge base + personalized context |
| 📄 **Multi-modal** | PDFs, images (OCR), videos (transcription), code (AST-aware chunking) via [MarkItDown](https://github.com/microsoft/markitdown) |
| 🐳 **Self-hosted** | Full Docker Compose setup — PostgreSQL, Redis, API, Web, MCP. One command to run |
| 🔌 **MCP Server** | Native MCP support for Claude Desktop, Cursor, Windsurf, VS Code and more |

---

## ⚡ Quick Start

> **Prerequisites:** [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
>
> ```bash
> # Clone the repo
> git clone https://github.com/MorkMindy74/Funes.git
> cd Funes
>
> # Copy and configure environment variables
> cp .env.example .env
> # Edit .env with your preferred settings (defaults work out of the box)
>
> # Launch everything with one command
> docker compose up --build
> ```
>
> Services will be available at:
> - **Web UI** → http://localhost:3000
> - - **API** → http://localhost:3001
>   - - **MCP Server** → http://localhost:3002
>     -
>     - ### Optional profiles
>     -
>     - ```bash
>       # With Firecrawl (advanced web scraping with JS rendering)
>       docker compose --profile with-firecrawl up --build
>
>       # With LEANN (97% vector storage reduction)
>       docker compose --profile with-leann up --build
>
>       # With local Ollama LLM
>       docker compose --profile with-ollama up --build
>       ```
>
>       ---
>
>       ## ✨ What's New
>
>       This fork goes significantly beyond the original Supermemory foundation. Here is a breakdown of every major improvement shipped.
>
>       ### Phase 1 — Security Hardening
>
>       **XSS Prevention via DOMPurify** — All user-generated content rendered via `innerHTML` is now sanitized through DOMPurify before insertion into the DOM, eliminating the entire class of stored and reflected XSS vulnerabilities in the browser extension's content scripts.
>
>       **Prompt Injection Sanitization** — A dedicated `sanitizeForLLM()` utility strips control characters, zero-width spaces, Unicode direction overrides, and other invisible characters that attackers embed in web content to hijack LLM context windows.
>
>       **Rate Limiting on OG Endpoint** — The Open Graph metadata endpoint now enforces per-IP rate limiting via a sliding window algorithm, preventing scraping abuse and denial-of-service attacks.
>
>       **CSRF Protection in Middleware** — A CSRF token validation layer has been added to all state-mutating API routes. Tokens are cryptographically bound to the session and verified server-side on every POST/PUT/DELETE request.
>
>       ### Phase 2 — Infrastructure & Reliability
>
>       **Structured Logging (pino-compatible)** — Replaced ad-hoc `console.log` calls with a structured, leveled logging system compatible with the pino interface. Every log entry is a JSON object with `level`, `timestamp`, `context`, and `message` fields — ready for log aggregation pipelines (Datadog, Loki, CloudWatch).
>
>       **Zod Environment Validation** — All environment variables are now validated at application startup using Zod schemas. Missing or malformed config fails fast with a human-readable error listing every invalid field.
>
>       **Circuit Breaker for External Services** — External service calls (connectors, webhook deliveries, third-party APIs) are now wrapped in a circuit breaker. After a configurable failure threshold, the breaker opens and returns cached or degraded responses, preventing cascade failures.
>
>       **Docker Compose Self-Hosted Setup** — A production-ready `docker-compose.yml` orchestrates PostgreSQL 16, Redis 7, the API backend, the Next.js frontend, and the MCP server. Optional profiles add Firecrawl, LEANN, and Ollama.
>
>       **LEANN Pluggable Vector Backend** — Introduced a `VectorBackend` abstraction that allows swapping LanceDB for LEANN, achieving up to 97% storage reduction for vector embeddings.
>
>       **Conversation Summarization** — Implemented a sliding window summarization strategy for long chat histories, keeping context windows lean without losing important information.
>
>       ### Phase 3 — Code Quality & Architecture
>
>       **Platform Adapter Pattern for Content Scripts** — The browser extension's content scripts have been refactored into a clean adapter pattern: each platform (ChatGPT, Claude, Gemini, etc.) implements a shared `PlatformAdapter` interface. Adding support for a new AI platform now requires touching exactly one file.
>
>       **40+ New Tests** — A comprehensive test suite covering: authentication flows, Open Graph utility functions, Zod validation schemas, rate limiter logic, sanitization functions, and circuit breaker state transitions. Test coverage went from near-zero on these modules to >80%.
>
>       **DAL Normalization with ApiResult Type** — All DAL functions now return a typed `ApiResult<T>` discriminated union (`{ ok: true, data: T } | { ok: false, error: AppError }`), making error handling explicit and exhaustive at the call site.
>
>       ### Phase 4 — Quick Fixes & Hardening
>
>       **Re-enabled MCP Schema Validation** — MCP tool call schemas that had been silently disabled have been re-enabled and tightened. Every tool input is now validated against its Zod schema before execution.
>
>       **Twitter/X Token Format Validation** — The Twitter connector's OAuth token handling now validates token format before attempting API calls.
>
>       **MarkItDown Integration** — Added `@repo/markitdown` TypeScript wrapper for universal document-to-Markdown conversion (PDFs, Office docs, images, audio, video).
>
>       **Missing Dependency Resolution** — Fixed module resolution errors in the test environment. The full test suite now runs cleanly with `bun test`.
>
>       ---
>
>       ## 🏗️ Architecture
>
>       ```
>       Your app / AI agent
>               ↓
>         Funes Engine
>               │
>               ├── Memory Engine     Extracts facts · tracks updates · resolves contradictions · auto-forgets
>               ├── User Profiles     Static facts + dynamic context, always fresh, ~50ms
>               ├── Hybrid Search     RAG + Memory in one query
>               ├── File Processing   PDFs · images · videos · code → searchable chunks (via MarkItDown)
>               └── MCP Server        Native MCP protocol for AI clients
>       ```
>
>       **Memory is not RAG.** RAG retrieves document chunks — stateless, same results for everyone. Memory extracts and tracks facts about users over time. Funes runs both together by default.
>
>       **Automatic forgetting.** Temporary facts ("I have an exam tomorrow") expire after the date passes. Contradictions are resolved automatically. Noise never becomes permanent memory.
>
>       ### Tech stack
>
>       | Layer | Technology |
>       |---|---|
>       | Runtime | Bun |
>       | API | Hono + TypeScript |
>       | Frontend | Next.js 15 |
>       | Database | PostgreSQL 16 (via Drizzle ORM) |
>       | Cache / Queue | Redis 7 |
>       | Vector store | LanceDB (default) / LEANN (optional) |
>       | Auth | better-auth |
>       | Logging | pino |
>       | Validation | Zod |
>       | Monorepo | Turborepo |
>       | Containerization | Docker Compose |
>
>       ---
>
>       ## 🐳 Self-Hosting
>
>       Funes is **fully self-hosted**. No Cloudflare, no external API dependencies, no cloud account required.
>
>       ### Environment variables
>
>       Copy `.env.example` to `.env` and review the settings. The most important ones:
>
>       ```bash
>       DB_PASSWORD=          # PostgreSQL password (default: funes_dev)
>       AUTH_SECRET=          # Auth secret — change this in production!
>       OLLAMA_URL=           # Optional: local LLM for memory extraction
>       OLLAMA_MODEL=         # Default: llama3.2
>       FIRECRAWL_URL=        # Optional: Firecrawl for advanced scraping
>       VECTOR_BACKEND=       # lancedb (default) or leann
>       ```
>
>       ### Services overview
>
>       | Service | Port | Description |
>       |---|---|---|
>       | `web` | 3000 | Next.js frontend |
>       | `api` | 3001 | Hono API backend |
>       | `mcp` | 3002 | MCP server for AI clients |
>       | `postgres` | 5432 | PostgreSQL database |
>       | `redis` | 6379 | Redis cache |
>       | `firecrawl` *(optional)* | 3003 | Web scraping with JS rendering |
>       | `leann` *(optional)* | 3005 | High-efficiency vector backend |
>       | `ollama` *(optional)* | 11434 | Local LLM |
>
>       ---
>
>       ## 🔌 MCP Clients
>
>       Connect Funes to any MCP-compatible AI client by pointing it to the MCP server at `http://localhost:3002`.
>
>       Tested with: **Claude Desktop · Cursor · Windsurf · VS Code · Claude Code**
>
>       ---
>
>       ## 🤝 Contributing
>
>       Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.
>
>       All PRs are reviewed for security impact. If your change touches the memory engine, sanitization layer, or any connector, please include tests.
>
>       ---
>
>       ## 🙏 Tribute
>
>       This project stands on the shoulders of a remarkable engineer.
>
>       Funes is a fork of [supermemory](https://github.com/supermemoryai/supermemory), created by [Sidhant Srivastava](https://github.com/sidharthsajith) — a young developer from India who built, from scratch, one of the most sophisticated AI memory systems ever published as open source.
>
>       Supermemory reached #1 on Hacker News, topped multiple AI memory benchmarks, and became a reference implementation for the entire field of persistent AI context.
>
>       Sidhant didn't just write good code. He wrote code that **thinks about memory the way memory actually works** — with forgetting, contradictions, temporal decay, and the difference between knowing a fact and knowing a person. That is a rare and genuinely hard thing to do.
>
>       This fork exists because the foundation Sidhant laid is exceptional, and because great foundations deserve to be built upon. Every improvement here starts from his work. The name may have changed, but the DNA is his.
>
>       Thank you, Sidhant.
>
>       ---
>
>       ## 📄 License
>
>       [MIT](LICENSE) — free to use, fork, and build upon.
>
>       Named after Ireneo Funes — the fictional young man from Uruguay who, after falling from a horse, could forget nothing. His gift was also his curse. We kept the gift.
>
>       *Built with obsession. Tested against reality.*</sub></em>
