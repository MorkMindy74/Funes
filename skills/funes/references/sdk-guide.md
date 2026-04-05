# Funes SDK Guide

Complete reference for all SDK methods — TypeScript and Python.

## Client Initialization

### TypeScript

```typescript
import { Funes } from 'funes-memory';

const client = new Funes({
  // optional: custom endpoint for self-hosted instance
  baseUrl: process.env.FUNES_API_URL,
});
```

### Python

```python
from funes_memory import Funes

client = Funes(
    base_url=os.environ.get("FUNES_API_URL")  # optional
)
```

## Core Methods

### `client.add()` — Store Content

Store any content as a memory.

```typescript
await client.add({
  content: string,          // text, URL, or HTML
  containerTag: string,     // user/project ID for isolation
  metadata?: object,        // custom key-value pairs
  isStatic?: boolean,       // mark as permanent memory
  tags?: string[],          // optional tags for filtering
});
```

### `client.profile()` — Get User Profile + Search

Retrieve a user profile combined with relevant memories in a single call (~50ms).

```typescript
const { profile, searchResults } = await client.profile({
  containerTag: string,     // user ID
  q?: string,               // optional search query
  limit?: number,           // max results (default: 10)
});

// profile.static    → string[] of permanent facts
// profile.dynamic   → string[] of recent context
// searchResults     → MemoryChunk[] relevant to q
```

### `client.search.memories()` — Hybrid Search

```typescript
const results = await client.search.memories({
  q: string,
  containerTag?: string,
  searchMode?: 'hybrid' | 'semantic' | 'keyword',
  threshold?: number,       // 0.0–1.0, default 0.3
  limit?: number,
  metadata?: object,        // filter by metadata
});
```

### `client.search.documents()` — Document Search

```typescript
const docs = await client.search.documents({
  q: string,
  containerTag?: string,
  fileType?: string,
  limit?: number,
});
```

### `client.documents.uploadFile()` — Upload Files

Supports PDFs, images (OCR via MarkItDown), videos (transcription), code (AST-aware chunking).

```typescript
await client.documents.uploadFile({
  file: ReadStream | Buffer | Blob,
  containerTag: string,
  metadata?: object,
});
```

### `client.documents.list()` — List Documents

```typescript
const docs = await client.documents.list({
  containerTag?: string,
  fileType?: string,
  limit?: number,
  offset?: number,
});
```

### `client.settings.update()` — Configure Engine

```typescript
await client.settings.update({
  memoryExtraction?: {
    enabled: boolean,
    model?: string,
  },
  chunking?: {
    chunkSize?: number,
    chunkOverlap?: number,
  },
});
```

## Integration Patterns

### Vercel AI SDK

```typescript
import { withFunes } from 'funes-memory/ai-sdk';

const model = withFunes(openai('gpt-4o'), 'user_123');
```

### Mastra

```typescript
import { withFunes } from 'funes-memory/mastra';

const agent = new Agent(withFunes(config, 'user-123', { mode: 'full' }));
```

### LangChain

```typescript
import { FunesRetriever } from 'funes-memory/langchain';

const retriever = new FunesRetriever({ containerTag: 'user_123' });
const chain = RetrievalQAChain.fromLLM(llm, retriever);
```

## Error Handling

All methods return typed `ApiResult` discriminated unions:

```typescript
const result = await client.add({ content, containerTag });

if (!result.ok) {
  console.error(result.error.code, result.error.message);
} else {
  console.log('Stored:', result.data.memoryId);
}
```

## Resources

- [GitHub](https://github.com/MorkMindy74/Funes)
- [API Reference](api-reference.md)
- [Architecture](architecture.md)
