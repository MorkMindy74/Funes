/**
 * Platform adapter pattern for content scripts.
 *
 * Extracts common logic (route detection, memory popup, auto-fetch, prompt capture)
 * into shared functions, with platform-specific behavior delegated to adapters.
 */

import { MESSAGE_TYPES, UI_CONFIG } from "../../utils/constants"
import {
	autoSearchEnabled,
	autoCapturePromptsEnabled,
} from "../../utils/storage"
import { sanitizeHTML } from "../../utils/sanitize"

// --- Platform Adapter Interface ---

export interface PlatformAdapter {
	/** Platform name for logging */
	platformName: string
	/** data attribute name used to mark initialization */
	initAttr: string
	/** Selector pattern for icon elements */
	iconSelector: string
	/** Get the main input element (textarea or contenteditable div) */
	getInputElement(): HTMLElement | null
	/** Get the text content from the input element */
	getInputContent(element: HTMLElement): string
	/** Set supermemories data on the input element */
	setSupermemories(element: HTMLElement, data: string): void
	/** Inject stored memories into the prompt before submission */
	injectMemories(element: HTMLElement, storedMemories: string): void
	/** Selectors to watch for in MutationObserver to detect DOM changes */
	observerSelectors: string[]
	/** Check if a submit button was clicked */
	isSubmitButton(target: HTMLElement): boolean
	/** Check if Enter key should trigger capture (based on target element) */
	isPromptTarget(target: HTMLElement): boolean
	/** Setup function called on route change / init */
	onRouteChange(): void
}

// --- Shared State ---

let debounceTimeout: NodeJS.Timeout | null = null
let routeObserver: MutationObserver | null = null
let urlCheckInterval: NodeJS.Timeout | null = null
let observerThrottle: NodeJS.Timeout | null = null

// --- Shared: Route Change Detection ---

export function setupRouteChangeDetection(adapter: PlatformAdapter) {
	if (routeObserver) {
		routeObserver.disconnect()
	}
	if (urlCheckInterval) {
		clearInterval(urlCheckInterval)
	}
	if (observerThrottle) {
		clearTimeout(observerThrottle)
		observerThrottle = null
	}

	let currentUrl = window.location.href

	const checkForRouteChange = () => {
		if (window.location.href !== currentUrl) {
			currentUrl = window.location.href
			console.log(`${adapter.platformName} route changed, re-initializing`)
			setTimeout(() => adapter.onRouteChange(), 1000)
		}
	}

	urlCheckInterval = setInterval(
		checkForRouteChange,
		UI_CONFIG.ROUTE_CHECK_INTERVAL,
	)

	routeObserver = new MutationObserver((mutations) => {
		if (observerThrottle) return

		let shouldRecheck = false
		for (const mutation of mutations) {
			if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
				for (const node of mutation.addedNodes) {
					if (node.nodeType === Node.ELEMENT_NODE) {
						const element = node as Element
						for (const selector of adapter.observerSelectors) {
							if (
								element.querySelector?.(selector) ||
								element.matches?.(selector)
							) {
								shouldRecheck = true
								break
							}
						}
					}
					if (shouldRecheck) break
				}
			}
			if (shouldRecheck) break
		}

		if (shouldRecheck) {
			observerThrottle = setTimeout(() => {
				try {
					observerThrottle = null
					adapter.onRouteChange()
				} catch (error) {
					console.error(
						`Error in ${adapter.platformName} observer callback:`,
						error,
					)
				}
			}, UI_CONFIG.OBSERVER_THROTTLE_DELAY)
		}
	})

	try {
		routeObserver.observe(document.body, { childList: true, subtree: true })
	} catch (error) {
		console.error(
			`Failed to set up ${adapter.platformName} route observer:`,
			error,
		)
		if (urlCheckInterval) clearInterval(urlCheckInterval)
		urlCheckInterval = setInterval(checkForRouteChange, 1000)
	}
}

// --- Shared: Icon Feedback UI ---

const CLOSE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`

export function updateIconFeedback(
	message: string,
	iconElement: HTMLElement,
	adapter: PlatformAdapter,
	resetAfter = 0,
) {
	if (!iconElement.dataset.originalHtml) {
		iconElement.dataset.originalHtml = iconElement.innerHTML
	}

	const feedbackDiv = document.createElement("div")
	feedbackDiv.style.cssText = `
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
		background: #513EA9;
		border-radius: 6px;
		color: white;
		font-size: 12px;
		font-weight: 500;
		cursor: ${message === "Included Memories" ? "pointer" : "default"};
		position: relative;
	`

	const checkSpan = document.createElement("span")
	checkSpan.textContent = "\u2713"
	const messageSpan = document.createElement("span")
	messageSpan.textContent = message
	feedbackDiv.appendChild(checkSpan)
	feedbackDiv.appendChild(messageSpan)

	if (message === "Included Memories" && iconElement.dataset.memoriesData) {
		const popup = createMemoriesPopup(iconElement, adapter)

		feedbackDiv.addEventListener("mouseenter", () => {
			const textSpan = feedbackDiv.querySelector("span:last-child")
			if (textSpan) textSpan.textContent = "Click to see memories"
		})

		feedbackDiv.addEventListener("mouseleave", () => {
			const textSpan = feedbackDiv.querySelector("span:last-child")
			if (textSpan) textSpan.textContent = "Included Memories"
		})

		feedbackDiv.addEventListener("click", (e) => {
			e.stopPropagation()
			popup.style.display = "block"
		})

		document.addEventListener("click", (e) => {
			if (!popup.contains(e.target as Node)) {
				popup.style.display = "none"
			}
		})

		setTimeout(() => {
			if (document.body.contains(popup)) {
				document.body.removeChild(popup)
			}
		}, 300000)
	}

	iconElement.innerHTML = ""
	iconElement.appendChild(feedbackDiv)

	if (resetAfter > 0) {
		setTimeout(() => {
			iconElement.innerHTML = iconElement.dataset.originalHtml || ""
			delete iconElement.dataset.originalHtml
		}, resetAfter)
	}
}

function createMemoriesPopup(
	iconElement: HTMLElement,
	adapter: PlatformAdapter,
): HTMLDivElement {
	const popup = document.createElement("div")
	popup.style.cssText = `
		position: fixed;
		bottom: 80px;
		left: 50%;
		transform: translateX(-50%);
		background: #1a1a1a;
		color: white;
		padding: 0;
		border-radius: 12px;
		font-size: 13px;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
		max-width: 500px;
		max-height: 400px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		z-index: 999999;
		display: none;
		border: 1px solid #333;
	`

	const header = document.createElement("div")
	header.style.cssText = `
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px;
		border-bottom: 1px solid #333;
		opacity: 0.8;
	`
	const headerSpan = document.createElement("span")
	headerSpan.style.cssText = "font-weight: 600; color: #fff;"
	headerSpan.textContent = "Included Memories"
	header.appendChild(headerSpan)

	const content = document.createElement("div")
	content.style.cssText = `
		padding: 0;
		max-height: 300px;
		overflow-y: auto;
	`

	const memoriesText = iconElement.dataset.memoriesData || ""
	const individualMemories = memoriesText
		.split(/[,\n]/)
		.map((memory) => memory.trim())
		.filter((memory) => memory.length > 0 && memory !== ",")

	individualMemories.forEach((memory, index) => {
		const memoryItem = document.createElement("div")
		memoryItem.style.cssText = `
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 10px;
			font-size: 13px;
			line-height: 1.4;
		`

		const memoryText = document.createElement("div")
		memoryText.style.cssText = "flex: 1; color: #e5e5e5;"
		memoryText.textContent = memory.trim()

		const removeBtn = document.createElement("button")
		removeBtn.style.cssText = `
			background: transparent;
			color: #9ca3af;
			border: none;
			padding: 4px;
			border-radius: 4px;
			cursor: pointer;
			flex-shrink: 0;
			height: fit-content;
			display: flex;
			align-items: center;
			justify-content: center;
		`
		removeBtn.innerHTML = CLOSE_ICON_SVG
		removeBtn.dataset.memoryIndex = index.toString()

		removeBtn.addEventListener("mouseenter", () => {
			removeBtn.style.color = "#ef4444"
		})
		removeBtn.addEventListener("mouseleave", () => {
			removeBtn.style.color = "#9ca3af"
		})

		memoryItem.appendChild(memoryText)
		memoryItem.appendChild(removeBtn)
		content.appendChild(memoryItem)
	})

	popup.appendChild(header)
	popup.appendChild(content)
	document.body.appendChild(popup)

	// Wire up remove buttons
	content.querySelectorAll("button[data-memory-index]").forEach((button) => {
		const htmlButton = button as HTMLButtonElement
		htmlButton.addEventListener("click", () => {
			const index = Number.parseInt(
				htmlButton.dataset.memoryIndex || "0",
				10,
			)
			const memoryItem = htmlButton.parentElement
			if (memoryItem) content.removeChild(memoryItem)

			const currentMemories = (iconElement.dataset.memoriesData || "")
				.split(/[,\n]/)
				.map((m) => m.trim())
				.filter((m) => m.length > 0 && m !== ",")
			currentMemories.splice(index, 1)

			const updatedMemories = currentMemories.join(" ,")
			iconElement.dataset.memoriesData = updatedMemories

			const inputElement = adapter.getInputElement()
			if (inputElement) {
				adapter.setSupermemories(
					inputElement,
					sanitizeHTML(updatedMemories),
				)
			}

			// Re-index remaining buttons
			content
				.querySelectorAll("button[data-memory-index]")
				.forEach((btn, newIndex) => {
					;(btn as HTMLButtonElement).dataset.memoryIndex =
						newIndex.toString()
				})

			if (currentMemories.length <= 1) {
				if (inputElement?.dataset.supermemories) {
					delete inputElement.dataset.supermemories
					delete iconElement.dataset.memoriesData
					iconElement.innerHTML = iconElement.dataset.originalHtml || ""
					delete iconElement.dataset.originalHtml
				}
				popup.style.display = "none"
				if (document.body.contains(popup)) {
					document.body.removeChild(popup)
				}
			}
		})
	})

	return popup
}

// --- Shared: Get Related Memories ---

export async function getRelatedMemories(
	adapter: PlatformAdapter,
	actionSource: string,
) {
	try {
		const inputElement = adapter.getInputElement()
		const userQuery = inputElement
			? adapter.getInputContent(inputElement)
			: ""

		if (!userQuery.trim()) {
			console.log(`No query text found for ${adapter.platformName}`)
			return
		}

		const icon = document.querySelector(adapter.iconSelector)
		const iconElement = icon as HTMLElement
		if (!iconElement) {
			console.warn(
				`${adapter.platformName} icon element not found, cannot update feedback`,
			)
			return
		}

		updateIconFeedback("Searching memories...", iconElement, adapter)

		const timeoutPromise = new Promise((_, reject) =>
			setTimeout(
				() => reject(new Error("Memory search timeout")),
				UI_CONFIG.API_REQUEST_TIMEOUT,
			),
		)

		const response = await Promise.race([
			browser.runtime.sendMessage({
				action: MESSAGE_TYPES.GET_RELATED_MEMORIES,
				data: userQuery,
				actionSource,
			}),
			timeoutPromise,
		])

		if (response?.success && response?.data) {
			const targetElement = adapter.getInputElement()
			if (targetElement) {
				adapter.setSupermemories(
					targetElement,
					sanitizeHTML(response.data),
				)
				iconElement.dataset.memoriesData = response.data
				updateIconFeedback("Included Memories", iconElement, adapter)
			} else {
				updateIconFeedback("Memories found", iconElement, adapter)
			}
		} else {
			updateIconFeedback("No memories found", iconElement, adapter)
		}
	} catch (error) {
		console.error(
			`Error getting related memories for ${adapter.platformName}:`,
			error,
		)
		try {
			const icon = document.querySelector(adapter.iconSelector) as HTMLElement
			if (icon) {
				updateIconFeedback("Error fetching memories", icon, adapter)
			}
		} catch (feedbackError) {
			console.error("Failed to update error feedback:", feedbackError)
		}
	}
}

// --- Shared: Auto-Fetch ---

export async function setupAutoFetch(adapter: PlatformAdapter) {
	const autoSearch = (await autoSearchEnabled.getValue()) ?? false
	if (!autoSearch) return

	const inputElement = adapter.getInputElement()
	if (!inputElement || inputElement.hasAttribute("data-supermemory-auto-fetch"))
		return

	inputElement.setAttribute("data-supermemory-auto-fetch", "true")

	const handleInput = () => {
		if (debounceTimeout) clearTimeout(debounceTimeout)

		debounceTimeout = setTimeout(async () => {
			const content = adapter.getInputContent(inputElement).trim()

			if (content.length > 2) {
				await getRelatedMemories(
					adapter,
					`${adapter.platformName.toLowerCase()}_chat_memories_auto_searched`,
				)
			} else if (content.length === 0) {
				// Reset icons
				const icons = document.querySelectorAll(adapter.iconSelector)
				icons.forEach((icon) => {
					const iconEl = icon as HTMLElement
					if (iconEl.dataset.originalHtml) {
						iconEl.innerHTML = iconEl.dataset.originalHtml
						delete iconEl.dataset.originalHtml
						delete iconEl.dataset.memoriesData
					}
				})
				if (inputElement.dataset.supermemories) {
					delete inputElement.dataset.supermemories
				}
			}
		}, UI_CONFIG.AUTO_SEARCH_DEBOUNCE_DELAY)
	}

	inputElement.addEventListener("input", handleInput)
}

// --- Shared: Prompt Capture ---

export function setupPromptCapture(adapter: PlatformAdapter) {
	const captureAttr = `data-${adapter.platformName.toLowerCase()}-prompt-capture-setup`
	if (document.body.hasAttribute(captureAttr)) return
	document.body.setAttribute(captureAttr, "true")

	const capturePromptContent = async (source: string) => {
		const autoCapture = (await autoCapturePromptsEnabled.getValue()) ?? false
		if (!autoCapture) return

		const inputElement = adapter.getInputElement()
		let promptContent = inputElement
			? adapter.getInputContent(inputElement)
			: ""

		const storedMemories = inputElement?.dataset.supermemories
		if (
			storedMemories &&
			inputElement &&
			!promptContent.includes("Supermemories of user")
		) {
			adapter.injectMemories(inputElement, sanitizeHTML(storedMemories))
			promptContent = adapter.getInputContent(inputElement)
		}

		if (promptContent.trim()) {
			try {
				await browser.runtime.sendMessage({
					action: MESSAGE_TYPES.CAPTURE_PROMPT,
					data: {
						prompt: promptContent,
						platform: adapter.platformName.toLowerCase(),
						source,
					},
				})
			} catch (error) {
				console.error(
					`Error sending ${adapter.platformName} prompt to background:`,
					error,
				)
			}
		}

		// Reset icons
		const icons = document.querySelectorAll(adapter.iconSelector)
		icons.forEach((icon) => {
			const iconEl = icon as HTMLElement
			if (iconEl.dataset.originalHtml) {
				iconEl.innerHTML = iconEl.dataset.originalHtml
				delete iconEl.dataset.originalHtml
				delete iconEl.dataset.memoriesData
			}
		})

		if (inputElement?.dataset.supermemories) {
			delete inputElement.dataset.supermemories
		}
	}

	document.addEventListener(
		"click",
		async (event) => {
			const target = event.target as HTMLElement
			if (adapter.isSubmitButton(target)) {
				await capturePromptContent("button click")
			}
		},
		true,
	)

	document.addEventListener(
		"keydown",
		async (event) => {
			const target = event.target as HTMLElement
			if (
				adapter.isPromptTarget(target) &&
				event.key === "Enter" &&
				!event.shiftKey
			) {
				await capturePromptContent("Enter key")
			}
		},
		true,
	)
}
