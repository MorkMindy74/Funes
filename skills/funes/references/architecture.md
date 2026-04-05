# Funes Architecture

How the Funes memory engine works under the hood.

## Overview

Funes builds a **living knowledge graph** rather than static document storage. Every piece of content is not just stored — it is processed, related to existing knowledge, and made available for retrieval in milliseconds.

## 6-Stage Processing Pipeline

```
Input Content
     ↓
1. Content Extraction   → MarkItDown (local, no external APIs)
     ↓
2. Semantic Analysis    → LLM extracts facts, tags, entities
     ↓
3. Embedding            → Cloudflare AI generates vector embeddings
     ↓
4. Chunking             → AST-aware chunking (code), semantic (text)
     ↓
5. Graph Construction   → Builds relationships (updates, extends, derives)
     ↓
6. Index                → Hybrid vector + keyword index
```

## Content Extraction: MarkItDown

Funes uses **MarkItDown** as its primary content extractor, replacing all external API dependencies:

- **PDFs** → text extraction + structure preservation
- **Images** → OCR via local processing
- **Videos** → transcription
- **Code** → AST-aware parsing
- **URLs** → web scraping + Markdown conversion
- **Office documents** → DOCX, XLSX, PPTX support

This makes Funes **fully self-contained** — no paid external APIs required.

## Memory Types

### Static Memories

Permanent facts that don't change:

```typescript
await client.add({
  content: "User's name is Marco",
  containerTag: "user_123",
  isStatic: true,  // never auto-forgotten
});
```

### Dynamic Memories

Contextual facts that may be updated or forgotten:

```typescript
await client.add({
  content: "User is currently working on a legal tech project",
  containerTag: "user_123",
  // no isStatic flag — can be superseded by new info
});
```

### Automatic Forgetting

Temporal facts expire automatically:

- "User has an exam tomorrow" → expired after the date
- Contradicting facts are resolved (latest wins by default)
- Noise is never promoted to permanent memory

## Memory Relationships

Memories are connected via typed relationships:

| Relationship | Meaning |
|---|---|
| `updates` | New fact supersedes old one |
| `extends` | New fact adds detail to existing one |
| `derives` | New fact is inferred from existing facts |
| `contradicts` | New fact conflicts (triggers resolution) |

## User Profiles

Profiles are assembled on-demand by combining:

1. **Static facts** — permanent, explicitly marked memories
2. **Dynamic context** — recent memories scored by recency + relevance
3. **Search results** — optional query-time retrieval

Profile assembly time: ~50ms

## Hybrid Search

Funes combines two retrieval strategies:

- **Semantic search**: vector similarity via embeddings
- **Keyword search**: BM25-style full-text matching
- **Fusion**: results ranked by combined score

## Security Architecture

Funes implements defense in depth:

- **XSS Prevention**: DOMPurify sanitizes all user-generated content
- **Prompt Injection Guard**: `sanitizeForLLM()` strips control characters and Unicode overrides
- **Rate Limiting**: sliding window per-IP on all public endpoints
- **CSRF Protection**: cryptographic token validation on all state-mutating routes
- **Circuit Breaker**: external calls wrapped with failure threshold + fallback

## Deployment

Funes runs on **Cloudflare Workers** (serverless):

- **Hyperdrive** for database connections
- **Cloudflare AI** for embeddings and LLM calls
- **KV Storage** for caching and session state
- **Cron Triggers** for periodic connector sync

## Resources

- [GitHub](https://github.com/MorkMindy74/Funes)
- [SDK Guide](sdk-guide.md)
- [API Reference](api-reference.md)
