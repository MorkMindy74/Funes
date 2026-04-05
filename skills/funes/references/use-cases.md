# Funes Use Cases

8 real-world implementation examples.

## 1. Personalized Chatbot

Build a chatbot that remembers users across sessions:

```typescript
import { Funes } from 'funes-memory';

const funes = new Funes();

async function chat(userId: string, userMessage: string) {
  // 1. Get user context before generating response
  const { profile, searchResults } = await funes.profile({
    containerTag: userId,
    q: userMessage,
  });

  const systemPrompt = `You are a personalized assistant.

User Profile:
${profile.static.join('\n')}

Recent Context:
${profile.dynamic.join('\n')}

Relevant Memories:
${searchResults.map(r => r.content).join('\n')}`;

  // 2. Generate response with full context
  const response = await llm.chat(systemPrompt, userMessage);

  // 3. Store conversation for future sessions
  await funes.add({
    content: `User: ${userMessage}\nAssistant: ${response}`,
    containerTag: userId,
    metadata: { type: 'conversation', timestamp: Date.now() },
  });

  return response;
}
```

## 2. Long-Term Task Assistant

Assistant that tracks ongoing projects and goals:

```typescript
// Store project goals as static memories
await funes.add({
  content: "User is building a legal tech platform with AI capabilities",
  containerTag: "user_123",
  isStatic: true,
});

// Store progress updates as dynamic memories
await funes.add({
  content: "Completed authentication module, working on document processing",
  containerTag: "user_123",
  metadata: { type: 'progress', project: 'legal-tech' },
});
```

## 3. Document Knowledge Base

Index and search a document library:

```typescript
// Index documents via MarkItDown (local extraction)
for (const filePath of documentPaths) {
  await funes.documents.uploadFile({
    file: fs.createReadStream(filePath),
    containerTag: "legal_docs",
    metadata: { category: 'contract', year: 2026 },
  });
}

// Search semantically
const results = await funes.search.documents({
  q: "penalty clauses in employment contracts",
  containerTag: "legal_docs",
  metadata: { category: 'contract' },
});
```

## 4. Customer Support AI

Support agent with full customer history:

```typescript
async function handleTicket(customerId: string, issue: string) {
  const { profile, searchResults } = await funes.profile({
    containerTag: `customer_${customerId}`,
    q: issue,
  });

  // searchResults contains similar past issues and resolutions
  const pastResolutions = searchResults
    .filter(r => r.metadata?.type === 'resolution')
    .map(r => r.content);

  return generateResponse(profile, pastResolutions, issue);
}
```

## 5. Code Review Assistant

Assistant that learns your codebase conventions:

```typescript
// Index codebase
await funes.add({
  content: fs.readFileSync('./src/patterns.ts', 'utf8'),
  containerTag: 'project_patterns',
  metadata: { type: 'code_pattern' },
});

// Query conventions during review
const conventions = await funes.search.memories({
  q: `error handling pattern for ${filename}`,
  containerTag: 'project_patterns',
  searchMode: 'semantic',
});
```

## 6. Learning Companion

Personalized tutor that tracks learning progress:

```typescript
// Track what user has learned
await funes.add({
  content: `User completed module: TypeScript generics. Score: 92%`,
  containerTag: `student_${userId}`,
  metadata: { type: 'progress', subject: 'typescript', module: 'generics' },
});

// Personalize next lesson
const { profile } = await funes.profile({
  containerTag: `student_${userId}`,
  q: 'typescript advanced topics',
});
// profile reveals gaps and strengths for adaptive learning
```

## 7. Multi-Tenant SaaS Application

Isolate memory per organization and user:

```typescript
// Organization-level knowledge
await funes.add({
  content: companyKnowledgeBase,
  containerTag: `org_${orgId}`,
  isStatic: true,
});

// User-level personalization within org
await funes.add({
  content: userPreferences,
  containerTag: `org_${orgId}_user_${userId}`,
});

// Search within org scope only
const results = await funes.search.memories({
  q: query,
  containerTag: `org_${orgId}`,  // strict tenant isolation
});
```

## 8. Research Assistant

Assistant that builds a growing knowledge graph from research:

```typescript
// Index research papers via MarkItDown (PDFs processed locally)
for (const paper of researchPapers) {
  await funes.documents.uploadFile({
    file: paper.pdfBuffer,
    containerTag: `research_${topic}`,
    metadata: { authors: paper.authors, year: paper.year, doi: paper.doi },
  });
}

// Cross-paper semantic search
const related = await funes.search.documents({
  q: 'transformer attention mechanisms for long documents',
  containerTag: `research_${topic}`,
  limit: 20,
});

// Funes automatically builds relationships between papers
// pointing to similar findings, contradictions, extensions
```

## Resources

- [GitHub](https://github.com/MorkMindy74/Funes)
- [SDK Guide](sdk-guide.md)
- [Quickstart](quickstart.md)
