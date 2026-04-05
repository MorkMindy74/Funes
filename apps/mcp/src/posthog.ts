/**
 * Analytics — No-op for self-hosted.
 * PostHog tracking removed. All analytics are logged instead.
 */

import { createLogger } from "@repo/lib/logger"

const logger = createLogger("mcp-analytics")

export function initPosthog(_apiKey?: string): void {
  // No-op for self-hosted
}

export async function memoryAdded(props: Record<string, unknown>): Promise<void> {
  logger.debug({ event: "memory_added", ...props }, "Memory added")
}

export async function memorySearch(props: Record<string, unknown>): Promise<void> {
  logger.debug({ event: "memory_search", ...props }, "Memory search")
}

export async function memoryForgot(props: Record<string, unknown>): Promise<void> {
  logger.debug({ event: "memory_forgot", ...props }, "Memory forgot")
}

export async function shutdown(): Promise<void> {
  // No-op
}

export const posthog = {
  init: initPosthog,
  memoryAdded,
  memorySearch,
  memoryForgot,
  shutdown,
}
