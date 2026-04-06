/**
 * Entity & Relationship Extractor — extracts graph data from text.
 *
 * Uses Ollama (LLM) when available, falls back to NLP (compromise.js).
 * Returns entities (nodes) and relationships (edges) for the knowledge graph.
 */

import { env } from "../env.js"
import { logger } from "../logger.js"

export interface ExtractedEntity {
	name: string
	type: "person" | "organization" | "location" | "concept" | "event" | "tool"
	properties?: Record<string, unknown>
	confidence: number
}

/** Raw shape returned by the LLM before validation */
interface RawEntity {
	name?: unknown
	type?: unknown
	confidence?: unknown
	properties?: Record<string, unknown>
}

/** Raw shape returned by the LLM before validation */
interface RawRelationship {
	source?: unknown
	target?: unknown
	relation?: unknown
	confidence?: unknown
	properties?: Record<string, unknown>
}

export interface ExtractedRelationship {
	source: string // entity name
	target: string // entity name
	relation: string // e.g. "works_at", "lives_in", "created", "uses"
	confidence: number
	properties?: Record<string, unknown>
}

export interface GraphExtractionResult {
	entities: ExtractedEntity[]
	relationships: ExtractedRelationship[]
}

/**
 * Extract entities and relationships from text content.
 */
export async function extractGraph(
	content: string,
	options?: { title?: string },
): Promise<GraphExtractionResult> {
	if (!content || content.trim().length < 30) {
		return { entities: [], relationships: [] }
	}

	if (env.OLLAMA_URL) {
		try {
			return await extractWithOllama(content, options)
		} catch (err) {
			logger.warn(
				{ err },
				"Graph extraction via Ollama failed, falling back to NLP",
			)
		}
	}

	return extractWithNLP(content, options)
}

// ─── LLM-based extraction ─────────────────────────────────────────

async function extractWithOllama(
	content: string,
	options?: { title?: string; customPrompt?: string },
): Promise<GraphExtractionResult> {
	let prompt: string

	if (options?.customPrompt) {
		// Apply template variables to custom prompt
		prompt = options.customPrompt
			.replace(/\{\{content\}\}/g, content.slice(0, 4000))
			.replace(/\{\{title\}\}/g, options?.title ?? "Unknown")
			.replace(/\{\{maxEntities\}\}/g, "20")
	} else {
		prompt = `Extract entities and relationships from the following text. Return a JSON object with:

{
  "entities": [
    { "name": "Entity Name", "type": "person|organization|location|concept|event|tool", "confidence": 0.0-1.0 }
  ],
  "relationships": [
    { "source": "Entity A", "target": "Entity B", "relation": "works_at|lives_in|created|uses|knows|manages|part_of|related_to", "confidence": 0.0-1.0 }
  ]
}

Rules:
- Normalize entity names (capitalize properly, no duplicates)
- Use specific relation types when possible
- Only extract clearly stated facts, not speculation
- Confidence reflects how explicitly the relationship is stated
- Maximum 20 entities and 20 relationships

Title: ${options?.title ?? "Unknown"}

Content (truncated):
${content.slice(0, 4000)}

Return ONLY valid JSON, no markdown, no explanation.`
	}

	const response = await fetch(`${env.OLLAMA_URL}/api/generate`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: env.OLLAMA_MODEL,
			prompt,
			stream: false,
			format: "json",
			options: { temperature: 0.1 },
		}),
		signal: AbortSignal.timeout(60000),
	})

	if (!response.ok) throw new Error(`Ollama returned ${response.status}`)

	const data = (await response.json()) as { response: string }
	const parsed = JSON.parse(data.response) as {
		entities?: RawEntity[]
		relationships?: RawRelationship[]
	}

	const entities: ExtractedEntity[] = (parsed.entities ?? [])
		.slice(0, 20)
		.map((e) => ({
			name: normalizeEntityName(String(e.name ?? "")),
			type: validateEntityType(String(e.type ?? "concept")),
			confidence:
				typeof e.confidence === "number"
					? Math.min(1, Math.max(0, e.confidence))
					: 0.7,
			properties: e.properties,
		}))
		.filter((e: ExtractedEntity) => e.name.length > 1)

	const entityNames = new Set(entities.map((e) => e.name.toLowerCase()))

	const relationships: ExtractedRelationship[] = (parsed.relationships ?? [])
		.slice(0, 20)
		.map((r) => ({
			source: normalizeEntityName(String(r.source ?? "")),
			target: normalizeEntityName(String(r.target ?? "")),
			relation: normalizeRelation(String(r.relation ?? "related_to")),
			confidence:
				typeof r.confidence === "number"
					? Math.min(1, Math.max(0, r.confidence))
					: 0.6,
			properties: r.properties,
		}))
		.filter(
			(r: ExtractedRelationship) =>
				r.source.length > 1 &&
				r.target.length > 1 &&
				r.source !== r.target &&
				// Ensure both endpoints exist as entities
				entityNames.has(r.source.toLowerCase()) &&
				entityNames.has(r.target.toLowerCase()),
		)

	logger.debug(
		{ entities: entities.length, relationships: relationships.length },
		"Graph extracted via Ollama",
	)

	return { entities, relationships }
}

// ─── NLP-based extraction (fallback) ──────────────────────────────

async function extractWithNLP(
	content: string,
	_options?: { title?: string },
): Promise<GraphExtractionResult> {
	const nlp = (await import("compromise")).default
	const doc = nlp(content)

	const entities: ExtractedEntity[] = []
	const seen = new Set<string>()

	// Extract people
	const people = (doc as any).people?.().out("array") as string[] | undefined
	for (const p of (people ?? []).slice(0, 10)) {
		const name = normalizeEntityName(p)
		if (name.length > 1 && !seen.has(name.toLowerCase())) {
			seen.add(name.toLowerCase())
			entities.push({ name, type: "person", confidence: 0.7 })
		}
	}

	// Extract places
	const places = (doc as any).places?.().out("array") as string[] | undefined
	for (const p of (places ?? []).slice(0, 10)) {
		const name = normalizeEntityName(p)
		if (name.length > 1 && !seen.has(name.toLowerCase())) {
			seen.add(name.toLowerCase())
			entities.push({ name, type: "location", confidence: 0.6 })
		}
	}

	// Extract organizations
	const orgs = (doc as any).organizations?.().out("array") as
		| string[]
		| undefined
	for (const o of (orgs ?? []).slice(0, 10)) {
		const name = normalizeEntityName(o)
		if (name.length > 1 && !seen.has(name.toLowerCase())) {
			seen.add(name.toLowerCase())
			entities.push({ name, type: "organization", confidence: 0.6 })
		}
	}

	// NLP can't reliably extract relationships — return entities only
	return { entities, relationships: [] }
}

// ─── Helpers ──────────────────────────────────────────────────────

function normalizeEntityName(name: string): string {
	return (
		name
			.trim()
			.replace(/\s+/g, " ")
			// Title case
			.replace(/\b\w/g, (c) => c.toUpperCase())
	)
}

const VALID_ENTITY_TYPES = new Set([
	"person",
	"organization",
	"location",
	"concept",
	"event",
	"tool",
])

function validateEntityType(type: string): ExtractedEntity["type"] {
	const normalized = String(type ?? "concept").toLowerCase()
	return VALID_ENTITY_TYPES.has(normalized)
		? (normalized as ExtractedEntity["type"])
		: "concept"
}

function normalizeRelation(relation: string): string {
	return (
		relation
			.toLowerCase()
			.trim()
			.replace(/\s+/g, "_")
			.replace(/[^a-z0-9_]/g, "") || "related_to"
	)
}

// ─── Custom prompt extraction ────────────────────────────────────

/**
 * Extract graph entities using organization's custom prompt if configured.
 * Falls back to the standard extractGraph when no custom prompt is set.
 */
export async function extractGraphWithCustomPrompt(
	content: string,
	orgId: string,
	options?: { title?: string },
): Promise<GraphExtractionResult> {
	if (!content || content.trim().length < 30) {
		return { entities: [], relationships: [] }
	}

	// Check for custom extraction prompt in org settings
	try {
		const { eq } = await import("drizzle-orm")
		const { db } = await import("../db/index.js")
		const { organizationSettings } = await import("../db/schema.js")

		const [settings] = await db
			.select({
				customExtractionPrompt: organizationSettings.customExtractionPrompt,
			})
			.from(organizationSettings)
			.where(eq(organizationSettings.orgId, orgId))
			.limit(1)

		if (settings?.customExtractionPrompt) {
			const prompt = settings.customExtractionPrompt

			// Validate: must contain {{content}} placeholder and be under 4000 chars
			if (!prompt.includes("{{content}}")) {
				logger.warn(
					{ orgId },
					"Custom extraction prompt missing {{content}} placeholder — using default",
				)
			} else if (prompt.length > 4000) {
				logger.warn(
					{ orgId },
					"Custom extraction prompt exceeds 4000 chars — using default",
				)
			} else if (env.OLLAMA_URL) {
				try {
					return await extractWithOllama(content, {
						title: options?.title,
						customPrompt: prompt,
					})
				} catch (err) {
					logger.warn(
						{ err, orgId },
						"Custom prompt extraction failed — falling back to default",
					)
				}
			}
		}
	} catch (err) {
		logger.debug(
			{ err, orgId },
			"Could not fetch custom extraction prompt — using default",
		)
	}

	// Fallback to standard extraction
	return extractGraph(content, options)
}
