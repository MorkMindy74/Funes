/**
 * Memory level types — predisposto per pattern EverMemOS (M7.4).
 * In M2, solo FACT viene usato. Livelli superiori arrivano con Ollama + M7.
 */
export enum MemoryLevel {
	/** Concrete fact extracted from document */
	FACT = "fact",
	/** User preference inferred from patterns */
	PREFERENCE = "preference",
	/** User profile trait (e.g., "developer", "speaks Italian") */
	PROFILE = "profile",
	/** Episodic memory — specific event or experience */
	EPISODIC = "episodic",
	/** Core memory — fundamental, long-term knowledge */
	CORE = "core",
}

export interface ExtractedMemory {
	memory: string
	level: MemoryLevel
	confidence: number
	isStatic: boolean
	metadata?: Record<string, unknown>
}
