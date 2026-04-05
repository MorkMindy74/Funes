import { describe, it, expect } from "vitest"
import { z } from "zod"
import {
	MemoryAddSchema,
	SearchRequestSchema,
} from "../api"

describe("MemoryAddSchema", () => {
	it("accepts valid memory input", () => {
		const result = MemoryAddSchema.safeParse({
			content: "Test memory content",
		})
		expect(result.success).toBe(true)
	})

	it("accepts empty object (all fields optional)", () => {
		const result = MemoryAddSchema.safeParse({})
		expect(result.success).toBe(true)
	})

	it("accepts optional containerTags", () => {
		const result = MemoryAddSchema.safeParse({
			content: "Test",
			containerTags: ["project-1"],
		})
		expect(result.success).toBe(true)
	})
})

describe("SearchRequestSchema", () => {
	it("accepts valid search input", () => {
		const result = SearchRequestSchema.safeParse({
			q: "test query",
		})
		expect(result.success).toBe(true)
	})

	it("requires q field", () => {
		const result = SearchRequestSchema.safeParse({})
		expect(result.success).toBe(false)
	})

	it("accepts optional fields", () => {
		const result = SearchRequestSchema.safeParse({
			q: "test",
			limit: 5,
			containerTags: ["project-1"],
		})
		expect(result.success).toBe(true)
	})
})
