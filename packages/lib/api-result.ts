/**
 * Normalized API result type for consistent error handling.
 *
 * Wraps the $fetch response pattern into a discriminated union type,
 * making error handling explicit and type-safe.
 */

export interface AppError {
	code: string
	message: string
	status?: number
	details?: unknown
}

export type ApiResult<T> =
	| { ok: true; data: T }
	| { ok: false; error: AppError }

/**
 * Wraps a $fetch call and normalizes the response into an ApiResult.
 *
 * @param fetchFn - A function that calls $fetch and returns its response
 * @returns Normalized ApiResult with either data or a structured error
 *
 * @example
 * ```typescript
 * const result = await fetchResult(() =>
 *   $fetch("@post/documents", { body: { content: "test" } })
 * )
 * if (result.ok) {
 *   console.log(result.data)
 * } else {
 *   console.error(result.error.code, result.error.message)
 * }
 * ```
 */
export async function fetchResult<T>(
	fetchFn: () => Promise<{
		data: T
		error: { message?: string; status?: number } | null
	}>,
): Promise<ApiResult<T>> {
	try {
		const response = await fetchFn()

		if (response.error) {
			return {
				ok: false,
				error: {
					code: "API_ERROR",
					message: response.error.message ?? "An unknown error occurred",
					status: response.error.status,
				},
			}
		}

		return { ok: true, data: response.data }
	} catch (error) {
		return {
			ok: false,
			error: {
				code: "NETWORK_ERROR",
				message:
					error instanceof Error ? error.message : "Network request failed",
			},
		}
	}
}
