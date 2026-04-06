/**
 * Reranker interface — pluggable post-retrieval relevance scoring.
 *
 * Rerankers run after vector search to re-score results based on
 * semantic relevance to the original query text (not just embedding distance).
 */

export interface RerankInput {
	id: string
	content: string
	score: number // original vector similarity score
}

export interface RerankOutput {
	id: string
	score: number // original score preserved
	rerankedScore: number // 0-1 relevance from reranker
}

export interface Reranker {
	name: string

	/**
	 * Re-score results by semantic relevance to the query.
	 * Returns results sorted by rerankedScore descending, limited to topK.
	 */
	rerank(
		query: string,
		results: RerankInput[],
		topK: number,
	): Promise<RerankOutput[]>
}
