import type { ModelId } from "@/lib/models"

const CLOUD_MODELS: ModelId[] = ["gpt-5", "claude-sonnet-4.5", "gemini-2.5-pro"]

function flattenError(e: unknown): string {
	if (e == null) return ""
	if (typeof e === "string") return e
	if (e instanceof Error) {
		const parts = [e.message]
		for (let c: unknown = e.cause; c instanceof Error; c = c.cause) {
			parts.push(c.message)
		}
		return parts.join(" ")
	}
	return String(e)
}

export function getNovaChatErrorCopy(error: unknown, model: ModelId) {
	const msg = flattenError(error)

	// No LLM configured
	const noLLM = /no llm configured/i.test(msg) || /503/i.test(msg)
	if (noLLM) {
		return {
			title: "No LLM configured",
			body: "Start Ollama to enable chat: docker compose --profile with-ollama up. Then pull a model: docker exec -it funes-ollama-1 ollama pull llama3.2",
			otherModels: [] as ModelId[],
		}
	}

	// Gemini geo-restriction
	const geminiGeo =
		/user location is not supported/i.test(msg) ||
		(/failed_precondition/i.test(msg) && /location is not supported/i.test(msg))

	if (geminiGeo) {
		return {
			title: "This model isn't available in your region",
			body: "Gemini can't be used from your location. Try Ollama (local) instead.",
			otherModels: ["ollama" as ModelId],
		}
	}

	// Ollama connection error
	const ollamaError = /ECONNREFUSED/i.test(msg) || /ollama/i.test(msg)
	if (ollamaError && model === "ollama") {
		return {
			title: "Can't connect to Ollama",
			body: "Make sure Ollama is running. Start with: docker compose --profile with-ollama up",
			otherModels: CLOUD_MODELS,
		}
	}

	const body =
		msg.length > 200
			? `${msg.slice(0, 197).trim()}…`
			: msg || "Try again or switch models."
	return {
		title: "Something went wrong",
		body,
		otherModels: model === "ollama" ? CLOUD_MODELS : ["ollama" as ModelId],
	}
}
