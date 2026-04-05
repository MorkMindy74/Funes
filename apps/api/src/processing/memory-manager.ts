/**
 * Memory Manager — EverMemOS-style advanced memory lifecycle.
 *
 * Handles:
 * - Consolidation: merge similar memories, boost confidence
 * - Reinforcement: increase confidence when a memory is re-encountered
 * - Temporal decay: reduce confidence over time for non-static memories
 * - Forgetting: mark low-confidence or expired memories as forgotten
 * - Versioning: create new versions when memories evolve
 * - Level promotion: promote memories from FACT → CORE based on reinforcement
 */

import { eq, and, desc, lt, sql, isNull } from "drizzle-orm"
import { nanoid } from "nanoid"
import { db } from "../db/index.js"
import { memoryEntries, memoryDocumentSources } from "../db/schema.js"
import { generateEmbedding } from "./embeddings.js"
import { searchMemories, indexMemories } from "../vector/lancedb.js"
import { MemoryLevel, type ExtractedMemory } from "./memory-types.js"
import { logger } from "../logger.js"

// ─── Configuration ────────────────────────────────────────────────

/** Minimum similarity to consider two memories as duplicates */
const CONSOLIDATION_THRESHOLD = 0.85

/** Minimum confidence below which memories are forgotten */
const FORGET_THRESHOLD = 0.15

/** Daily decay rate for non-static memories */
const DECAY_RATE = 0.005

/** Confidence boost when a memory is reinforced */
const REINFORCE_BOOST = 0.1

/** Source count threshold for promoting FACT → CORE */
const CORE_PROMOTION_SOURCES = 5

/** Source count threshold for FACT → PREFERENCE */
const PREFERENCE_PROMOTION_SOURCES = 3

// ─── Consolidation ────────────────────────────────────────────────

/**
 * Check if a new memory already exists (or is very similar) and consolidate.
 * Returns the existing memory ID if consolidated, or null if it's new.
 */
export async function consolidateOrCreate(
	mem: ExtractedMemory,
	spaceId: string,
	orgId: string,
	userId: string | null,
	documentId: string,
): Promise<string> {
	// Generate embedding for the new memory
	const embedding = await generateEmbedding(mem.memory)

	// Search for similar existing memories
	const similar = await searchMemories(embedding, {
		limit: 3,
		filter: spaceId ? `spaceId = "${spaceId}"` : undefined,
	}).catch(() => [])

	// Check for duplicates/near-duplicates
	for (const match of similar) {
		if (match.score >= CONSOLIDATION_THRESHOLD) {
			// Found a very similar memory — reinforce it instead of creating a new one
			await reinforceMemory(match.id, mem.confidence, documentId)
			logger.debug(
				{ existingId: match.id, score: match.score, memory: mem.memory.slice(0, 60) },
				"MemoryManager: consolidated with existing memory",
			)
			return match.id
		}
	}

	// No duplicate found — create new memory
	const memId = nanoid()
	const { getEmbeddingModelName } = await import("./embeddings.js")
	const modelName = getEmbeddingModelName()

	await db.insert(memoryEntries).values({
		id: memId,
		memory: mem.memory,
		spaceId,
		orgId,
		userId,
		confidence: mem.confidence,
		memoryLevel: mem.level,
		isStatic: mem.isStatic,
		memoryEmbedding: embedding,
		memoryEmbeddingModel: modelName,
		metadata: mem.metadata ?? null,
		version: 1,
		isLatest: true,
		sourceCount: 1,
		createdAt: new Date(),
		updatedAt: new Date(),
	})

	// Link memory to document
	await db.insert(memoryDocumentSources).values({
		memoryEntryId: memId,
		documentId,
		relevanceScore: mem.confidence * 100,
		addedAt: new Date(),
	})

	// Index in LanceDB
	await indexMemories([{ id: memId, memory: mem.memory, spaceId, embedding }])

	return memId
}

// ─── Reinforcement ────────────────────────────────────────────────

/**
 * Reinforce an existing memory — increase confidence and source count.
 * Also checks for level promotion.
 */
export async function reinforceMemory(
	memoryId: string,
	newConfidence: number,
	documentId: string,
): Promise<void> {
	const [existing] = await db
		.select()
		.from(memoryEntries)
		.where(eq(memoryEntries.id, memoryId))
		.limit(1)

	if (!existing) return

	// Boost confidence: weighted average + boost, capped at 1.0
	const boostedConfidence = Math.min(
		1.0,
		existing.confidence! * 0.7 + newConfidence * 0.3 + REINFORCE_BOOST,
	)

	const newSourceCount = (existing.sourceCount ?? 1) + 1

	// Check for level promotion
	const newLevel = checkLevelPromotion(
		existing.memoryLevel as MemoryLevel,
		newSourceCount,
		boostedConfidence,
	)

	await db
		.update(memoryEntries)
		.set({
			confidence: boostedConfidence,
			sourceCount: newSourceCount,
			memoryLevel: newLevel,
			// Unforgotten if it was forgotten
			isForgotten: false,
			forgetReason: null,
			updatedAt: new Date(),
		})
		.where(eq(memoryEntries.id, memoryId))

	// Link to the new document source (ignore if already linked)
	await db
		.insert(memoryDocumentSources)
		.values({
			memoryEntryId: memoryId,
			documentId,
			relevanceScore: newConfidence * 100,
			addedAt: new Date(),
		})
		.onConflictDoNothing()

	if (newLevel !== existing.memoryLevel) {
		logger.info(
			{ memoryId, from: existing.memoryLevel, to: newLevel, sources: newSourceCount },
			"MemoryManager: memory promoted",
		)
	}
}

// ─── Level Promotion ──────────────────────────────────────────────

/**
 * Check if a memory should be promoted to a higher level
 * based on reinforcement count and confidence.
 */
function checkLevelPromotion(
	currentLevel: MemoryLevel,
	sourceCount: number,
	confidence: number,
): MemoryLevel {
	// Only promote upward: FACT → PREFERENCE → CORE
	if (currentLevel === MemoryLevel.FACT) {
		if (sourceCount >= CORE_PROMOTION_SOURCES && confidence >= 0.8) {
			return MemoryLevel.CORE
		}
		if (sourceCount >= PREFERENCE_PROMOTION_SOURCES && confidence >= 0.6) {
			return MemoryLevel.PREFERENCE
		}
	}

	if (currentLevel === MemoryLevel.PREFERENCE) {
		if (sourceCount >= CORE_PROMOTION_SOURCES && confidence >= 0.8) {
			return MemoryLevel.CORE
		}
	}

	// PROFILE and EPISODIC don't auto-promote
	return currentLevel
}

// ─── Temporal Decay ───────────────────────────────────────────────

/**
 * Apply temporal decay to all non-static memories.
 * Should be called periodically (e.g., daily via cron or BullMQ repeatable job).
 *
 * Decay formula: confidence = confidence * (1 - DECAY_RATE)^days_since_update
 *
 * Level-aware decay rates:
 * - CORE: no decay
 * - PROFILE: 25% of normal rate
 * - PREFERENCE: 50% of normal rate
 * - FACT: normal rate
 * - EPISODIC: 150% of normal rate (events fade faster)
 */
export async function applyTemporalDecay(): Promise<{ decayed: number; forgotten: number }> {
	const now = new Date()
	let decayed = 0
	let forgotten = 0

	// Get all non-static, non-forgotten, non-core memories
	const memories = await db
		.select({
			id: memoryEntries.id,
			confidence: memoryEntries.confidence,
			memoryLevel: memoryEntries.memoryLevel,
			updatedAt: memoryEntries.updatedAt,
			isStatic: memoryEntries.isStatic,
		})
		.from(memoryEntries)
		.where(
			and(
				eq(memoryEntries.isLatest, true),
				eq(memoryEntries.isForgotten, false),
				eq(memoryEntries.isStatic, false),
			),
		)

	for (const mem of memories) {
		// Skip CORE memories — they don't decay
		if (mem.memoryLevel === MemoryLevel.CORE) continue

		// Calculate days since last update
		const daysSinceUpdate = (now.getTime() - mem.updatedAt.getTime()) / (1000 * 60 * 60 * 24)
		if (daysSinceUpdate < 1) continue // Skip if updated today

		// Level-aware decay multiplier
		const decayMultiplier = getDecayMultiplier(mem.memoryLevel as MemoryLevel)
		const effectiveRate = DECAY_RATE * decayMultiplier

		// Apply decay
		const newConfidence = Math.max(0, (mem.confidence ?? 1) * (1 - effectiveRate * daysSinceUpdate))

		if (newConfidence < FORGET_THRESHOLD) {
			// Below threshold — forget
			await db
				.update(memoryEntries)
				.set({
					isForgotten: true,
					confidence: newConfidence,
					forgetReason: "temporal_decay",
					updatedAt: now,
				})
				.where(eq(memoryEntries.id, mem.id))
			forgotten++
		} else if (Math.abs(newConfidence - (mem.confidence ?? 1)) > 0.001) {
			// Significant change — update
			await db
				.update(memoryEntries)
				.set({ confidence: newConfidence, updatedAt: now })
				.where(eq(memoryEntries.id, mem.id))
			decayed++
		}
	}

	logger.info({ decayed, forgotten }, "MemoryManager: temporal decay applied")
	return { decayed, forgotten }
}

function getDecayMultiplier(level: MemoryLevel): number {
	switch (level) {
		case MemoryLevel.CORE:
			return 0 // No decay
		case MemoryLevel.PROFILE:
			return 0.25
		case MemoryLevel.PREFERENCE:
			return 0.5
		case MemoryLevel.FACT:
			return 1.0
		case MemoryLevel.EPISODIC:
			return 1.5
		default:
			return 1.0
	}
}

// ─── Forget Expired ───────────────────────────────────────────────

/**
 * Mark memories that have passed their forgetAfter date as forgotten.
 */
export async function forgetExpired(): Promise<number> {
	const now = new Date()

	const result = await db
		.update(memoryEntries)
		.set({
			isForgotten: true,
			forgetReason: "expired",
			updatedAt: now,
		})
		.where(
			and(
				eq(memoryEntries.isForgotten, false),
				lt(memoryEntries.forgetAfter, now),
			),
		)
		.returning({ id: memoryEntries.id })

	if (result.length > 0) {
		logger.info({ count: result.length }, "MemoryManager: expired memories forgotten")
	}

	return result.length
}

// ─── Memory Versioning ────────────────────────────────────────────

/**
 * Update a memory's content, creating a new version.
 * The old version is kept with isLatest = false.
 */
export async function updateMemoryWithVersion(
	memoryId: string,
	newContent: string,
	reason?: string,
): Promise<string | null> {
	const [existing] = await db
		.select()
		.from(memoryEntries)
		.where(eq(memoryEntries.id, memoryId))
		.limit(1)

	if (!existing) return null

	// Mark current as not latest
	await db
		.update(memoryEntries)
		.set({ isLatest: false, updatedAt: new Date() })
		.where(eq(memoryEntries.id, memoryId))

	// Create new version
	const newId = nanoid()
	const embedding = await generateEmbedding(newContent)
	const { getEmbeddingModelName } = await import("./embeddings.js")

	await db.insert(memoryEntries).values({
		id: newId,
		memory: newContent,
		spaceId: existing.spaceId,
		orgId: existing.orgId,
		userId: existing.userId,
		confidence: existing.confidence,
		memoryLevel: existing.memoryLevel,
		isStatic: existing.isStatic,
		memoryEmbedding: embedding,
		memoryEmbeddingModel: getEmbeddingModelName(),
		metadata: {
			...(existing.metadata as Record<string, unknown> | null),
			versionReason: reason,
		},
		version: (existing.version ?? 1) + 1,
		isLatest: true,
		parentMemoryId: memoryId,
		rootMemoryId: existing.rootMemoryId ?? memoryId,
		sourceCount: existing.sourceCount,
		memoryRelations: {
			...(existing.memoryRelations as Record<string, string> | null),
			[memoryId]: "updates",
		},
		createdAt: new Date(),
		updatedAt: new Date(),
	})

	// Index new version in LanceDB
	await indexMemories([
		{
			id: newId,
			memory: newContent,
			spaceId: existing.spaceId,
			embedding,
		},
	])

	logger.info(
		{ oldId: memoryId, newId, version: (existing.version ?? 1) + 1 },
		"MemoryManager: memory version created",
	)

	return newId
}

// ─── Confidence-Weighted RAG Retrieval ────────────────────────────

/**
 * Enhanced memory retrieval for RAG: combines vector similarity with
 * confidence scoring and memory level priority.
 *
 * Final score = similarity * confidenceWeight * levelBoost
 */
export async function retrieveMemoriesForRAG(
	queryEmbedding: number[],
	options: {
		limit?: number
		minSimilarity?: number
		spaceId?: string
	} = {},
): Promise<
	Array<{
		id: string
		memory: string
		score: number
		confidence: number
		level: string
		sourceCount: number
	}>
> {
	const limit = options.limit ?? 10
	const minSimilarity = options.minSimilarity ?? 0.25

	// Get more results from LanceDB than needed, then re-rank
	const vectorResults = await searchMemories(queryEmbedding, {
		limit: limit * 3,
		filter: options.spaceId ? `spaceId = "${options.spaceId}"` : undefined,
	})

	if (vectorResults.length === 0) return []

	// Fetch confidence and level data from PostgreSQL
	const memoryIds = vectorResults.map((r) => r.id)
	const dbMemories = await db
		.select({
			id: memoryEntries.id,
			confidence: memoryEntries.confidence,
			memoryLevel: memoryEntries.memoryLevel,
			sourceCount: memoryEntries.sourceCount,
			isForgotten: memoryEntries.isForgotten,
			isLatest: memoryEntries.isLatest,
		})
		.from(memoryEntries)
		.where(
			sql`${memoryEntries.id} IN (${sql.join(
				memoryIds.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		)

	const dbMap = new Map(dbMemories.map((m) => [m.id, m]))

	// Re-rank: similarity × confidence × levelBoost
	const ranked = vectorResults
		.map((result) => {
			const meta = dbMap.get(result.id)
			if (!meta || meta.isForgotten || !meta.isLatest) return null

			const confidence = meta.confidence ?? 0.5
			const levelBoost = getLevelBoost(meta.memoryLevel as MemoryLevel)
			const finalScore = result.score * (0.6 + 0.4 * confidence) * levelBoost

			return {
				id: result.id,
				memory: result.memory,
				score: finalScore,
				confidence,
				level: meta.memoryLevel ?? "fact",
				sourceCount: meta.sourceCount ?? 1,
			}
		})
		.filter((r): r is NonNullable<typeof r> => r !== null && r.score >= minSimilarity)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)

	return ranked
}

/** Boost scores for higher-level memories */
function getLevelBoost(level: MemoryLevel): number {
	switch (level) {
		case MemoryLevel.CORE:
			return 1.3
		case MemoryLevel.PROFILE:
			return 1.2
		case MemoryLevel.PREFERENCE:
			return 1.1
		case MemoryLevel.FACT:
			return 1.0
		case MemoryLevel.EPISODIC:
			return 0.9
		default:
			return 1.0
	}
}

// ─── Maintenance ──────────────────────────────────────────────────

/**
 * Run all memory maintenance tasks (decay + expire + cleanup).
 * Call this periodically (e.g., daily).
 */
export async function runMemoryMaintenance(): Promise<{
	decayed: number
	forgotten: number
	expired: number
}> {
	const decayResult = await applyTemporalDecay()
	const expired = await forgetExpired()

	return {
		decayed: decayResult.decayed,
		forgotten: decayResult.forgotten,
		expired,
	}
}
