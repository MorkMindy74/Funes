const MAX_CHARS = 200000
const DEFAULT_PROJECT_ID = "sm_project_default"

export type Memory =
  | { id: string; memory: string; similarity: number; title?: string; content?: string }
  | { id: string; chunk: string; similarity: number; title?: string; content?: string }

export interface SearchResult {
  results: Memory[]
  total: number
  timing: number
}

export interface Profile {
  static: string[]
  dynamic: string[]
}

export interface ProfileResponse {
  profile: Profile
  searchResults?: SearchResult
}

export interface Project {
  id: string
  name: string
  containerTag: string
  createdAt: string
  updatedAt: string
  isExperimental: boolean
  documentCount?: number
}

export interface DocumentMemoryEntry {
  id: string
  memory: string
  spaceId: string
  isStatic?: boolean
  isLatest?: boolean
  isForgotten?: boolean
  version?: number
  createdAt: string
  updatedAt: string
}

export interface DocumentWithMemories {
  id: string
  title: string | null
  summary?: string | null
  type: string
  createdAt: string
  updatedAt: string
  memoryEntries: DocumentMemoryEntry[]
}

export interface DocumentsApiResponse {
  documents: DocumentWithMemories[]
  pagination: {
    currentPage: number
    limit: number
    totalItems: number
    totalPages: number
  }
}

export function getMemoryText(m: Memory): string {
  return "memory" in m ? m.memory : m.chunk
}

function limitByChars(text: string, maxChars = MAX_CHARS): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text
}

/**
 * Client that calls the Funes local API directly via fetch.
 * No external SDK dependency.
 */
export class FunesClient {
  private bearerToken: string
  private containerTag: string
  private apiUrl: string

  constructor(
    bearerToken: string,
    containerTag?: string,
    apiUrl = "http://localhost:3001",
  ) {
    this.bearerToken = bearerToken
    this.apiUrl = apiUrl
    this.containerTag = containerTag || DEFAULT_PROJECT_ID
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.bearerToken}`,
      "Content-Type": "application/json",
    }
  }

  async createMemory(content: string): Promise<{ id: string; status: string; containerTag: string }> {
    const response = await fetch(`${this.apiUrl}/v3/documents`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        content,
        containerTags: [this.containerTag],
        metadata: { sm_source: "mcp" },
      }),
    })
    if (!response.ok) this.handleHttpError(response)
    const data = await response.json() as any
    return {
      id: data.id ?? data.documentId ?? "unknown",
      status: "queued",
      containerTag: this.containerTag,
    }
  }

  async forgetMemory(content: string): Promise<{ success: boolean; message: string; containerTag: string }> {
    // Search for matching memory first
    const searchResult = await this.search(content, 5, 0.85)
    if (searchResult.results.length === 0) {
      return {
        success: false,
        message: "No matching memory found to forget.",
        containerTag: this.containerTag,
      }
    }

    const memoryToDelete = searchResult.results[0]
    if (!memoryToDelete) {
      return {
        success: false,
        message: "No matching memory found.",
        containerTag: this.containerTag,
      }
    }

    // Delete the document
    const response = await fetch(`${this.apiUrl}/v3/documents/${memoryToDelete.id}`, {
      method: "DELETE",
      headers: this.headers(),
    })

    if (!response.ok) {
      return {
        success: false,
        message: `Failed to delete: ${response.statusText}`,
        containerTag: this.containerTag,
      }
    }

    return {
      success: true,
      message: `Forgot memory (similarity: ${memoryToDelete.similarity.toFixed(2)}): "${limitByChars(getMemoryText(memoryToDelete), 100)}"`,
      containerTag: this.containerTag,
    }
  }

  async search(query: string, limit = 10, threshold?: number): Promise<SearchResult> {
    const startTime = Date.now()
    const response = await fetch(`${this.apiUrl}/v3/search`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        q: query,
        limit,
        containerTags: [this.containerTag],
        chunkThreshold: threshold ?? 0,
      }),
    })
    if (!response.ok) this.handleHttpError(response)
    const data = await response.json() as any

    const results: Memory[] = (data.results || []).map((r: any) => {
      const chunks = r.chunks || []
      const bestChunk = chunks.sort((a: any, b: any) => (b.score || 0) - (a.score || 0))[0]
      const text = limitByChars(bestChunk?.content || r.title || "")
      return {
        id: r.documentId,
        memory: text,
        similarity: r.score || 0,
        title: r.title,
        content: bestChunk?.content,
      }
    })

    return {
      results,
      total: data.total || results.length,
      timing: Date.now() - startTime,
    }
  }

  async getProfile(query?: string): Promise<ProfileResponse> {
    const response = await fetch(`${this.apiUrl}/v4/profile`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        q: query,
        containerTag: this.containerTag,
      }),
    })
    if (!response.ok) this.handleHttpError(response)
    const data = await response.json() as any

    const profile: Profile = {
      static: (data.static || []).map((f: any) => f.memory || f),
      dynamic: (data.dynamic || []).map((m: any) => m.memory || m),
    }

    const response2: ProfileResponse = { profile }

    if (query && data.search?.length > 0) {
      response2.searchResults = {
        results: data.search.map((r: any) => ({
          id: r.id || "unknown",
          memory: limitByChars(r.memory || ""),
          similarity: r.score || 0,
        })),
        total: data.search.length,
        timing: 0,
      }
    }

    return response2
  }

  async getProjects(): Promise<string[]> {
    const response = await fetch(`${this.apiUrl}/v3/projects`, {
      method: "GET",
      headers: this.headers(),
    })
    if (!response.ok) this.handleHttpError(response)
    const data = await response.json() as any
    return (data.projects || []).map((p: any) => p.containerTag)
  }

  async getDocuments(containerTags?: string[], page = 1, limit = 200): Promise<DocumentsApiResponse> {
    const response = await fetch(`${this.apiUrl}/v3/documents/documents`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        page,
        limit,
        sort: "createdAt",
        order: "desc",
        containerTags,
      }),
    })
    if (!response.ok) this.handleHttpError(response)
    return await response.json() as DocumentsApiResponse
  }

  private handleHttpError(response: Response): never {
    const status = response.status
    switch (status) {
      case 401:
        throw new Error("Authentication failed. Please re-authenticate.")
      case 403:
        throw new Error("Access forbidden.")
      case 404:
        throw new Error("Resource not found.")
      case 429:
        throw new Error("Rate limit exceeded. Please wait and try again.")
      default:
        if (status >= 500) {
          throw new Error("Server error. Please try again later.")
        }
        throw new Error(`Request failed with status ${status}: ${response.statusText}`)
    }
  }
}
