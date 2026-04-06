# Funes

> *"His memory, sir, is like a garbage heap."*
> — Jorge Luis Borges, [Funes, His Memory](https://it.wikipedia.org/wiki/Funes,_o_della_memoria) (1942)

**The memory and context engine for AI. Impossibly fast. Impossibly thorough.**
Like Ireneo Funes, who forgot nothing — your AI will forget nothing either.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/MorkMindy74/Funes/blob/main/LICENSE)
[![Last Commit](https://img.shields.io/github/last-commit/MorkMindy74/Funes)](https://github.com/MorkMindy74/Funes/commits/main)
[![CI Status](https://img.shields.io/github/actions/workflow/status/MorkMindy74/Funes/ci.yml?branch=main&label=CI)](https://github.com/MorkMindy74/Funes/actions)
![Security Hardened](https://img.shields.io/badge/security-hardened-green)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript)
![Built with Claude](https://img.shields.io/badge/built%20with-Claude%20Opus%204.6-blueviolet?logo=anthropic)

[Quick Start](#-quick-start) · [What's New](#-whats-new) · [Self-Hosting](#-self-hosting) · [Tribute](#-tribute)

---

## What is Funes?

Funes is a **production-grade memory and context layer** for AI agents and applications. It automatically extracts facts from conversations, builds persistent user profiles, resolves contradictions, handles temporal forgetting, and delivers the right context at exactly the right moment.

**Your AI forgets everything between conversations. Funes fixes that.**

| Capability | What it does |
|---|---|
| Memory Engine | Extracts facts, tracks updates, resolves contradictions, auto-forgets expired info |
| User Profiles | Auto-maintained static facts + dynamic context. One call, ~50ms |
| Hybrid Search | RAG + Memory in a single query |
| Multi-modal | PDFs, images (OCR), videos, code via MarkItDown |
| Self-hosted | Full Docker Compose setup. One command to run |
| MCP Server | Native MCP support for Claude Desktop, Cursor, Windsurf, VS Code and more |

---

## Quick Start

Prerequisites: Docker and Docker Compose

    git clone https://github.com/MorkMindy74/Funes.git
    cd Funes
    cp .env.example .env
    docker compose up --build

Services:

- Web UI: http://localhost:3000
- API: http://localhost:3001
- MCP Server: http://localhost:3002

Optional profiles:

    docker compose --profile with-firecrawl up --build
    docker compose --profile with-leann up --build
    docker compose --profile with-ollama up --build

---

## What's New

This fork goes significantly beyond the original Supermemory foundation. Every improvement listed here has been shipped and is present in the codebase.

### Phase 1 — Security Hardening

**XSS Prevention via DOMPurify** — All user-generated content rendered via innerHTML is now sanitized through DOMPurify.

**Prompt Injection Sanitization** — sanitizeForLLM() strips control characters, zero-width spaces, and Unicode direction overrides.

**Rate Limiting on OG Endpoint** — Per-IP rate limiting via sliding window algorithm.

**CSRF Protection in Middleware** — CSRF token validation on all state-mutating API routes.

### Phase 2 — Infrastructure & Reliability

**Structured Logging (pino-compatible)** — Replaced console.log with a structured, leveled logging system.

**Zod Environment Validation** — All environment variables validated at startup.

**Circuit Breaker for External Services** — External calls wrapped in a circuit breaker.

**Docker Compose Self-Hosted Setup** — Orchestrates PostgreSQL 16, Redis 7, API, frontend, and MCP server. Optional profiles add Firecrawl, LEANN, and Ollama.

**LEANN Pluggable Vector Backend** — VectorBackend abstraction; LanceDB swappable for LEANN (97% storage reduction).

**Conversation Summarization** — Sliding window summarization for long chat histories.

### Phase 3 — Code Quality & Architecture

**Platform Adapter Pattern** — Browser extension refactored; each AI platform implements PlatformAdapter interface.

**40+ New Tests** — Auth flows, Open Graph, Zod schemas, rate limiter, sanitization, circuit breaker. Coverage from near-zero to 80%+.

**DAL Normalization with ApiResult Type** — All DAL functions return typed ApiResult discriminated union.

### Phase 4 — Quick Fixes & Hardening

**Re-enabled MCP Schema Validation** — MCP tool call schemas re-enabled and tightened.

**MarkItDown Integration** — @repo/markitdown wrapper for document-to-Markdown conversion.

**Missing Dependency Resolution** — Full test suite runs cleanly with bun test.

---

## Architecture

Memory is not RAG. RAG retrieves document chunks stateless. Memory extracts and tracks facts about users over time.

Automatic forgetting. Temporary facts expire. Contradictions are resolved automatically.

### Tech stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| API | Hono + TypeScript |
| Frontend | Next.js 15 |
| Database | PostgreSQL 16 via Drizzle ORM |
| Cache / Queue | Redis 7 |
| Vector store | LanceDB (default) / LEANN (optional) |
| Auth | better-auth |
| Logging | pino |
| Validation | Zod |
| Monorepo | Turborepo |
| Containerization | Docker Compose |

---

## Self-Hosting

Funes is **fully self-hosted**. No Cloudflare, no external API dependencies, no cloud account required.

Key environment variables:

    DB_PASSWORD=          # PostgreSQL password (default: funes_dev)
    AUTH_SECRET=          # Auth secret — change this in production!
    OLLAMA_URL=           # Optional: local LLM
    OLLAMA_MODEL=         # Default: llama3.2
    FIRECRAWL_URL=        # Optional: Firecrawl for web scraping
    VECTOR_BACKEND=       # lancedb (default) or leann

### Services

| Service | Port | Description |
|---|---|---|
| web | 3000 | Next.js frontend |
| api | 3001 | Hono API backend |
| mcp | 3002 | MCP server for AI clients |
| postgres | 5432 | PostgreSQL |
| redis | 6379 | Redis cache |
| firecrawl (optional) | 3003 | Web scraping with JS rendering |
| leann (optional) | 3005 | High-efficiency vector backend |
| ollama (optional) | 11434 | Local LLM |

---

## MCP Clients

Connect Funes to any MCP-compatible client at http://localhost:3002.

Tested with: Claude Desktop · Cursor · Windsurf · VS Code · Claude Code

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

Changes to the memory engine, sanitization layer, or any connector must include tests.

---

## Tribute

This project stands on the shoulders of a remarkable engineer.

Funes is a fork of [supermemory](https://github.com/supermemoryai/supermemory), created by [Sidhant Srivastava](https://github.com/sidharthsajith) — a young developer from India who built, from scratch, one of the most sophisticated AI memory systems ever published as open source.

Supermemory reached #1 on Hacker News, topped multiple AI memory benchmarks, and became a reference implementation for the entire field of persistent AI context.

Sidhant didn't just write good code. He wrote code that **thinks about memory the way memory actually works** — with forgetting, contradictions, temporal decay, and the difference between knowing a fact and knowing a person.

This fork exists because the foundation Sidhant laid is exceptional. Every improvement here starts from his work. The name may have changed, but the DNA is his.

Thank you, Sidhant.

---

## License

[MIT](LICENSE) — free to use, fork, and build upon.

Named after Ireneo Funes — the fictional young man from Uruguay who, after falling from a horse, could forget nothing. His gift was also his curse. We kept the gift.

*Built with obsession. Tested against reality.*
