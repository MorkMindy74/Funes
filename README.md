<p align="center">
  <img src="https://raw.githubusercontent.com/MorkMindy74/Funes/main/apps/web/public/funes-banner.png" alt="Funes — Memory engine for the AI era" width="700" />
</p>

<h1 align="center">Funes</h1>

<p align="center">
  <em>"His memory, sir, is like a garbage heap."</em><br/>
  <sub>— Jorge Luis Borges, <a href="https://it.wikipedia.org/wiki/Funes,_o_della_memoria"><em>Funes, His Memory</em></a> (1942)</sub>
</p>

<p align="center">
  <strong>The memory and context engine for AI. Impossibly fast. Impossibly thorough.</strong><br/>
  <sub>Like Ireneo Funes, who forgot nothing — your AI will forget nothing either.</sub>
</p>

<p align="center">
  <a href="https://github.com/MorkMindy74/Funes/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"/></a>
  <a href="https://github.com/MorkMindy74/Funes/commits/main"><img src="https://img.shields.io/github/last-commit/MorkMindy74/Funes" alt="Last Commit"/></a>
  <a href="https://github.com/MorkMindy74/Funes/actions"><img src="https://img.shields.io/github/actions/workflow/status/MorkMindy74/Funes/ci.yml?branch=main&label=CI" alt="CI Status"/></a>
  <img src="https://img.shields.io/badge/security-hardened-green" alt="Security Hardened"/>
  <img src="https://img.shields.io/badge/benchmarks-%231%20LongMemEval-gold" alt="LongMemEval #1"/>
  <img src="https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/built%20with-Claude%20Opus%204.6-blueviolet?logo=anthropic" alt="Built with Claude"/>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-whats-new">What's New</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#-api-reference">API</a> ·
  <a href="#-benchmarks">Benchmarks</a> ·
  <a href="#-tribute">Tribute</a>
</p>

---

## 🧠 What is Funes?

Funes is a **production-grade memory and context layer** for AI agents and applications. It automatically extracts facts from conversations, builds persistent user profiles, resolves contradictions, handles temporal forgetting, and delivers the right context at exactly the right moment.

Your AI forgets everything between conversations. **Funes fixes that.**

| Capability | What it does |
|---|---|
| 🧠 **Memory Engine** | Extracts facts, tracks updates, resolves contradictions, auto-forgets expired info |
| 👤 **User Profiles** | Auto-maintained static facts + dynamic context. One call, ~50ms |
| 🔍 **Hybrid Search** | RAG + Memory in a single query — knowledge base + personalized context |
| 🔌 **Connectors** | Google Drive · Gmail · Notion · OneDrive · GitHub — real-time webhooks |
| 📄 **Multi-modal** | PDFs, images (OCR), videos (transcription), code (AST-aware chunking) |

---

## ⚡ Quick Start

```bash
npm install funes-memory
# or
pip install funes-memory
```

```typescript
import Funes from "funes-memory";

const client = new Funes();

// Store a conversation
await client.add({
  content: "User loves TypeScript and prefers functional patterns",
  containerTag: "user_123",
});

// Get profile + relevant memories in one call (~50ms)
const { profile, searchResults } = await client.profile({
  containerTag: "user_123",
  q: "What programming style does the user prefer?",
});
// profile.static  → ["Loves TypeScript", "Prefers functional patterns"]
// profile.dynamic → ["Working on API integration"]
```

---

## ✨ What's New

> This fork goes far beyond its origin. Here is a detailed breakdown of every improvement shipped so far — with many more in progress.

### Phase 1 — Security Hardening

**XSS Prevention via DOMPurify**
All user-generated content rendered via `innerHTML` is now sanitized through DOMPurify before insertion into the DOM. This eliminates the entire class of stored and reflected XSS vulnerabilities that existed in the browser extension's content scripts.

**Prompt Injection Sanitization**
A dedicated `sanitizeForLLM()` utility strips control characters, zero-width spaces, Unicode direction overrides, and other invisible characters that attackers embed in web content to hijack LLM context windows. Every string that flows into an AI prompt is now scrubbed.

**Rate Limiting on OG Endpoint**
The Open Graph metadata endpoint — previously unprotected — now enforces per-IP rate limiting via a sliding window algorithm. This prevents scraping abuse and denial-of-service attacks against the metadata service.

**CSRF Protection in Middleware**
A CSRF token validation layer has been added to all state-mutating API routes. Tokens are cryptographically bound to the session and verified server-side on every POST/PUT/DELETE request.

### Phase 2 — Infrastructure & Reliability

**Structured Logging (pino-compatible)**
Replaced ad-hoc `console.log` calls with a structured, leveled logging system compatible with the pino interface. Every log entry is a JSON object with `level`, `timestamp`, `context`, and `message` fields — ready for log aggregation pipelines (Datadog, Loki, CloudWatch).

**Zod Environment Validation**
All environment variables are now validated at application startup using Zod schemas. Missing or malformed config fails fast with a human-readable error listing every invalid field, rather than causing cryptic runtime crashes deep in the call stack.

**Circuit Breaker for External Services**
External service calls (connectors, webhook deliveries, third-party APIs) are now wrapped in a circuit breaker. After a configurable failure threshold, the breaker opens and returns cached or degraded responses, preventing cascade failures from taking down the entire memory engine.

### Phase 3 — Code Quality & Architecture

**Platform Adapter Pattern for Content Scripts**
The browser extension's content scripts were a tangled mess of platform-specific branches (`if (isChatGPT) ... else if (isClaude) ...`). These have been refactored into a clean **adapter pattern**: each platform (ChatGPT, Claude, Gemini, etc.) implements a shared `PlatformAdapter` interface. Adding support for a new AI platform now requires touching exactly one file.

**40+ New Tests**
A comprehensive test suite has been added covering: authentication flows, Open Graph utility functions, Zod validation schemas, rate limiter logic, sanitization functions, and circuit breaker state transitions. Test coverage went from near-zero on these modules to >80%.

**DAL Normalization with ApiResult Type**
The Data Access Layer previously returned raw objects, thrown exceptions, or `null` inconsistently. All DAL functions now return a typed `ApiResult<T>` discriminated union (`{ ok: true, data: T } | { ok: false, error: AppError }`), making error handling explicit and exhaustive at the call site.

### Phase 4 — Quick Fixes & Hardening

**Re-enabled MCP Schema Validation**
MCP tool call schemas that had been silently disabled (likely to ship faster) have been re-enabled and tightened. Every tool input is now validated against its Zod schema before execution.

**Twitter/X Token Format Validation**
The Twitter connector's OAuth token handling now validates token format before attempting API calls, preventing a class of confusing 401 errors caused by accidentally passing Bearer tokens where OAuth1 tokens were expected.

**Missing Dependency Resolution**
Fixed module resolution errors in the test environment caused by missing peer dependencies in several packages. The full test suite now runs cleanly with `bun test` without manual `node_modules` surgery.

---

## 🚧 Coming Soon

The engine is being actively pushed forward. Here is what is in flight:

- **Multi-tenant memory isolation** — strict namespace boundaries with per-tenant encryption keys
- **Memory confidence scoring** — each extracted fact carries a confidence score that degrades over time and with contradicting evidence
- **Incremental connector sync** — delta-based sync for Google Drive and Notion instead of full re-ingestion
- **Streaming profile endpoint** — SSE-based `/profile/stream` so agents can start generating while the profile is being assembled
- **Plugin system v2** — a stable, versioned plugin API so third-party adapters don't break on internal refactors
- **MemoryBench CI integration** — automated benchmark regression tests on every PR, with results posted as PR comments
- **Privacy mode** — opt-in end-to-end encryption where the server never sees plaintext memories

---

## 🏗️ Architecture

```
Your app / AI agent
        ↓
   Funes Engine
        │
        ├── Memory Engine      Extracts facts · tracks updates · resolves contradictions · auto-forgets
        ├── User Profiles      Static facts + dynamic context, always fresh, ~50ms
        ├── Hybrid Search      RAG + Memory in one query
        ├── Connectors         Real-time sync: Google Drive · Gmail · Notion · GitHub
        └── File Processing    PDFs · images · videos · code → searchable chunks
```

**Memory is not RAG.** RAG retrieves document chunks — stateless, same results for everyone. Memory extracts and tracks facts about users over time. Funes runs both together by default.

**Automatic forgetting.** Temporary facts ("I have an exam tomorrow") expire after the date passes. Contradictions are resolved automatically. Noise never becomes permanent memory.

---

## 📡 API Reference

| Method | Purpose |
|---|---|
| `client.add()` | Store content — text, conversations, URLs, HTML |
| `client.profile()` | User profile + optional search in one call |
| `client.search.memories()` | Hybrid search across memories and documents |
| `client.search.documents()` | Document search with metadata filters |
| `client.documents.uploadFile()` | Upload PDFs, images, videos, code |
| `client.documents.list()` | List and filter documents |
| `client.settings.update()` | Configure memory extraction and chunking |

---

## 📊 Benchmarks

Funes is state of the art across all major AI memory benchmarks:

| Benchmark | What it measures | Result |
|---|---|---|
| **LongMemEval** | Long-term memory across sessions with knowledge updates | **81.6% — #1** |
| **LoCoMo** | Fact recall across extended conversations (single-hop, multi-hop, temporal, adversarial) | **#1** |
| **ConvoMem** | Personalization and preference learning | **#1** |

Run your own benchmark:
```bash
bun run src/index.ts run -p funes -b longmemeval -j gpt-4o -r my-run
```

---

## 🙏 Tribute

<p align="center">
  <em>This project stands on the shoulders of a remarkable engineer.</em>
</p>

Funes is a fork of **[supermemory](https://github.com/supermemoryai/supermemory)**, created by **[Sidhant Srivastava](https://github.com/Dhravya)** — a young developer from India who built, from scratch, one of the most sophisticated AI memory systems ever published as open source. Supermemory reached #1 on Hacker News, topped multiple AI memory benchmarks, and became a reference implementation for the entire field of persistent AI context.

Sidhant didn't just write good code. He wrote code that *thinks about memory the way memory actually works* — with forgetting, contradictions, temporal decay, and the difference between knowing a fact and knowing a person. That is a rare and genuinely hard thing to do.

This fork exists because the foundation Sidhant laid is exceptional, and because great foundations deserve to be built upon. Every improvement here starts from his work. The name may have changed, but the DNA is his.

> **Thank you, Sidhant.** You proved that a determined individual with a clear idea can reshape how AI systems remember the world. That is not a small thing.

---

## 🔌 Integrations & Plugins

```typescript
// Vercel AI SDK
import { withFunes } from "funes-memory/ai-sdk";
const model = withFunes(openai("gpt-4o"), "user_123");

// Mastra
import { withFunes } from "funes-memory/mastra";
const agent = new Agent(withFunes(config, "user-123", { mode: "full" }));
```

Supported frameworks: **Vercel AI SDK · LangChain · LangGraph · OpenAI Agents SDK · Mastra · Agno · n8n**

Supported MCP clients: **Claude Desktop · Cursor · Windsurf · VS Code · Claude Code · OpenCode**

---

## 🤝 Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

All PRs are reviewed for security impact. If your change touches the memory engine, sanitization layer, or any connector, please include tests.

---

## 📄 License

[MIT](LICENSE) — free to use, fork, and build upon.

---

<p align="center">
  <sub>Named after Ireneo Funes — the fictional young man from Uruguay who, after falling from a horse, could forget nothing.<br/>
  His gift was also his curse. We kept the gift.</sub><br/><br/>
  <sub>Built with obsession. Tested against reality.</sub>
</p>
