/**
 * LLM Provider — Configurable model resolution.
 *
 * Priority:
 *   1. Ollama (self-hosted, default) via OpenAI-compatible endpoint
 *   2. OpenAI / Google / xAI if API keys provided
 *   3. Error if nothing is configured
 */

import { createOpenAI } from "@ai-sdk/openai"
import { env } from "../env.js"
import { logger } from "../logger.js"
import type { LanguageModelV1 } from "ai"

// ─── Ollama via OpenAI-compatible endpoint ─────────────────────────

function getOllamaProvider() {
	if (!env.OLLAMA_URL) return null

	return createOpenAI({
		baseURL: `${env.OLLAMA_URL}/v1`,
		apiKey: "ollama", // Ollama doesn't need a real key but the SDK requires one
		name: "ollama",
	})
}

// ─── Model resolution ──────────────────────────────────────────────

export interface ResolvedModel {
	model: LanguageModelV1
	displayName: string
	provider: string
}

/**
 * Resolve a model ID from the frontend to an actual AI SDK model instance.
 *
 * The frontend sends model IDs like "gemini-2.5-pro", "claude-sonnet-4-5", "gpt-5".
 * We map these to whatever is available locally.
 */
export function resolveModel(requestedModel?: string): ResolvedModel {
	// Ollama is always preferred for self-hosted
	const ollama = getOllamaProvider()

	if (ollama) {
		const ollamaModel = env.OLLAMA_MODEL || "llama3.2"
		logger.debug({ requestedModel, resolved: ollamaModel }, "Resolving LLM model via Ollama")

		return {
			model: ollama(ollamaModel),
			displayName: ollamaModel,
			provider: "ollama",
		}
	}

	// Optional: external providers if API keys are set
	if (process.env.OPENAI_API_KEY) {
		const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
		const modelId = requestedModel?.includes("gpt") ? requestedModel : "gpt-4o-mini"
		return {
			model: openai(modelId),
			displayName: modelId,
			provider: "openai",
		}
	}

	if (process.env.GOOGLE_AI_API_KEY) {
		// Google AI SDK would go here — for now, suggest Ollama
		logger.warn("Google AI API key found but not yet supported in chat backend. Use Ollama.")
	}

	throw new Error(
		"No LLM provider configured. Set OLLAMA_URL (recommended) or OPENAI_API_KEY in your environment. " +
		"For Ollama: docker compose --profile with-ollama up",
	)
}

/**
 * Check if any LLM provider is available.
 */
export function isLLMAvailable(): boolean {
	return !!(env.OLLAMA_URL || process.env.OPENAI_API_KEY)
}

/**
 * Get information about available LLM providers.
 */
export function getLLMInfo(): { available: boolean; provider: string; model: string } {
	if (env.OLLAMA_URL) {
		return {
			available: true,
			provider: "ollama",
			model: env.OLLAMA_MODEL || "llama3.2",
		}
	}
	if (process.env.OPENAI_API_KEY) {
		return {
			available: true,
			provider: "openai",
			model: "gpt-4o-mini",
		}
	}
	return { available: false, provider: "none", model: "none" }
}
