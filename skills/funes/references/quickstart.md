# Funes Quickstart Guide

Get Funes running in your project in under 5 minutes.

## Prerequisites

- Node.js 18+ or Python 3.9+
- A Funes instance (self-hosted or cloud)

## Installation

### TypeScript / JavaScript

```bash
npm install funes-memory
# or
bun add funes-memory
# or
yarn add funes-memory
```

### Python

```bash
pip install funes-memory
```

## Basic Setup

### TypeScript

```typescript
import { Funes } from 'funes-memory';

const client = new Funes();

// Add a memory
await client.add({
  content: "User prefers TypeScript and functional programming patterns",
  containerTag: "user_123",
});

// Retrieve user profile and relevant memories
const { profile, searchResults } = await client.profile({
  containerTag: "user_123",
  q: "What programming style does the user prefer?",
});

console.log(profile.static);  // ["Prefers TypeScript", "Functional programming"]
console.log(searchResults);   // Relevant memory chunks
```

### Python

```python
from funes_memory import Funes

client = Funes()

# Add a memory
client.add(
    content="User prefers TypeScript and functional programming patterns",
    container_tag="user_123"
)

# Retrieve context
result = client.profile(
    container_tag="user_123",
    q="What programming style does the user prefer?"
)

print(result.profile.static)   # ["Prefers TypeScript", ...]
print(result.search_results)   # Relevant memory chunks
```

## Content Extraction

Funes uses **MarkItDown** for local content extraction — no external API required:

```typescript
// Add a URL (content extracted locally via MarkItDown)
await client.add({
  content: "https://example.com/article",
  containerTag: "project_42",
});

// Add a document
await client.documents.uploadFile({
  file: fs.createReadStream('./doc.pdf'),
  containerTag: "project_42",
});
```

## Next Steps

- [SDK Documentation](sdk-guide.md) — full API reference
- [Architecture](architecture.md) — how the memory engine works
- [Use Cases](use-cases.md) — real-world implementation examples
- [GitHub](https://github.com/MorkMindy74/Funes) — source code and issues
