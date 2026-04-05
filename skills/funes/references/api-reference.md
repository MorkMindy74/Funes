# Funes API Reference

Complete REST API endpoint documentation.

## Base URL

```
https://your-funes-instance.com
```

## Authentication

All endpoints require a Bearer token:

```bash
curl -H "Authorization: Bearer $FUNES_API_KEY" ...
```

## Documents & Memories

### `POST /v3/documents` — Add Document

```bash
curl -X POST /v3/documents \
  -H "Authorization: Bearer $FUNES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "User loves TypeScript and clean architecture",
    "containerTag": "user_123",
    "metadata": { "source": "chat" }
  }'
```

**Response:**
```json
{
  "id": "doc_abc123",
  "status": "processing",
  "memoryId": "mem_xyz789"
}
```

### `GET /v3/documents` — List Documents

```bash
curl "/v3/documents?containerTag=user_123&limit=20"
```

### `DELETE /v3/documents/:id` — Delete Document

```bash
curl -X DELETE /v3/documents/doc_abc123
```

## Search

### `POST /v3/search` — Hybrid Search

```bash
curl -X POST /v3/search \
  -d '{
    "q": "What programming languages does the user prefer?",
    "containerTag": "user_123",
    "searchMode": "hybrid",
    "threshold": 0.3,
    "limit": 10
  }'
```

**Response:**
```json
{
  "results": [
    {
      "content": "User loves TypeScript",
      "score": 0.92,
      "metadata": { "source": "chat" },
      "createdAt": "2026-04-05T08:00:00Z"
    }
  ]
}
```

## Memories (v4)

### `POST /v4/memories` — Create Direct Memory

Create an explicit memory fact (bypasses extraction pipeline):

```bash
curl -X POST /v4/memories \
  -d '{
    "content": "User is a TypeScript developer",
    "containerTag": "user_123",
    "isStatic": true
  }'
```

## User Profiles

### `GET /v4/profile/:containerTag` — Get Profile

```bash
curl "/v4/profile/user_123?q=programming+preferences"
```

**Response:**
```json
{
  "profile": {
    "static": ["TypeScript developer", "Prefers functional patterns"],
    "dynamic": ["Working on memory engine project"]
  },
  "searchResults": [
    { "content": "...", "score": 0.87 }
  ]
}
```

## Settings

### `PATCH /v3/settings` — Update Settings

```bash
curl -X PATCH /v3/settings \
  -d '{
    "memoryExtraction": { "enabled": true },
    "chunking": { "chunkSize": 512, "chunkOverlap": 64 }
  }'
```

## Error Codes

| Code | Meaning |
|------|---------|
| `400` | Bad Request — missing required field |
| `401` | Unauthorized — invalid API key |
| `404` | Not Found — resource does not exist |
| `429` | Rate Limited — slow down requests |
| `500` | Internal Error — contact support |

## Resources

- [GitHub](https://github.com/MorkMindy74/Funes)
- [SDK Guide](sdk-guide.md)
- [Architecture](architecture.md)
