import { describe, it, expect, vi, beforeEach } from "vitest"
import { isApiKey, validateApiKey, validateOAuthToken } from "../auth"

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

describe("isApiKey", () => {
	it("returns true for tokens starting with sm_", () => {
		expect(isApiKey("sm_abc123")).toBe(true)
		expect(isApiKey("sm_")).toBe(true)
	})

	it("returns false for other tokens", () => {
		expect(isApiKey("bearer_abc")).toBe(false)
		expect(isApiKey("")).toBe(false)
		expect(isApiKey("SM_abc")).toBe(false)
	})
})

describe("validateApiKey", () => {
	beforeEach(() => {
		mockFetch.mockReset()
	})

	it("returns user data for valid API key", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				user: { id: "user_123", email: "test@example.com", name: "Test" },
			}),
		})

		const result = await validateApiKey("sm_test123", "https://api.test.com")
		expect(result).toEqual({
			userId: "user_123",
			apiKey: "sm_test123",
			email: "test@example.com",
			name: "Test",
		})
	})

	it("returns null for 401 response", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
			text: async () => "Unauthorized",
		})

		const result = await validateApiKey("sm_invalid", "https://api.test.com")
		expect(result).toBeNull()
	})

	it("returns null for 403 response", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 403,
			text: async () => "Forbidden",
		})

		const result = await validateApiKey("sm_blocked", "https://api.test.com")
		expect(result).toBeNull()
	})

	it("returns null for 429 response", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 429,
			text: async () => "Rate limited",
		})

		const result = await validateApiKey(
			"sm_ratelimited",
			"https://api.test.com",
		)
		expect(result).toBeNull()
	})

	it("returns null for 500 response", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 500,
			text: async () => "Server error",
		})

		const result = await validateApiKey("sm_servererr", "https://api.test.com")
		expect(result).toBeNull()
	})

	it("returns null when user.id is missing", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ user: {} }),
		})

		const result = await validateApiKey("sm_noid", "https://api.test.com")
		expect(result).toBeNull()
	})

	it("returns null on network error", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Network error"))

		const result = await validateApiKey("sm_network", "https://api.test.com")
		expect(result).toBeNull()
	})
})

describe("validateOAuthToken", () => {
	beforeEach(() => {
		mockFetch.mockReset()
	})

	it("returns user data for valid OAuth token", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				userId: "user_456",
				apiKey: "sm_generated",
				email: "oauth@example.com",
				name: "OAuth User",
			}),
		})

		const result = await validateOAuthToken(
			"oauth_token",
			"https://api.test.com",
		)
		expect(result).toEqual({
			userId: "user_456",
			apiKey: "sm_generated",
			email: "oauth@example.com",
			name: "OAuth User",
		})
	})

	it("returns null for invalid token", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
			text: async () => "Invalid token",
		})

		const result = await validateOAuthToken("bad_token", "https://api.test.com")
		expect(result).toBeNull()
	})

	it("returns null when userId or apiKey missing", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ userId: "user_789" }), // missing apiKey
		})

		const result = await validateOAuthToken("partial", "https://api.test.com")
		expect(result).toBeNull()
	})

	it("returns null on network error", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Connection refused"))

		const result = await validateOAuthToken(
			"error_token",
			"https://api.test.com",
		)
		expect(result).toBeNull()
	})
})
