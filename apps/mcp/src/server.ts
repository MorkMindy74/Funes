import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { FunesClient, getMemoryText } from "./client.js"
import { env } from "./env.js"
import { z } from "zod"
import type { Context } from "hono"

interface UserProps {
  userId: string
  apiKey: string
  containerTag?: string
  email?: string
  name?: string
}

// Per-session MCP server + transport instances (in-memory)
interface SessionEntry {
  server: McpServer
  transport: StreamableHTTPServerTransport
}
const sessions = new Map<string, SessionEntry>()

function getSessionKey(props: UserProps): string {
  return `${props.userId}:${props.containerTag || "default"}`
}

function getClient(props: UserProps, containerTag?: string): FunesClient {
  return new FunesClient(
    props.apiKey,
    containerTag || props.containerTag,
    env.API_URL,
  )
}

export function createMcpServer(props: UserProps): McpServer {
  const server = new McpServer({
    name: "funes",
    version: "4.0.0",
  })

  const hasRootContainerTag = !!props.containerTag

  const containerTagField = {
    containerTag: z
      .string()
      .max(128, "Container tag exceeds maximum length")
      .describe("Optional project to scope memories")
      .optional(),
  }

  // ─── Memory Tool ─────────────────────────────────────────────────
  server.tool(
    "memory",
    "Save or forget information about the user. Use 'save' when user shares preferences, facts, or asks to remember something. Use 'forget' when information is outdated or user requests removal.",
    {
      content: z
        .string()
        .max(200000, "Content exceeds maximum length of 200,000 characters")
        .describe("The memory content to save or forget"),
      action: z.enum(["save", "forget"]).optional().default("save"),
      ...(hasRootContainerTag ? {} : containerTagField),
    },
    async (args) => {
      const { content, action = "save" } = args
      const effectiveContainerTag = (args as any).containerTag || props.containerTag
      const client = getClient(props, effectiveContainerTag)

      try {
        if (action === "forget") {
          const result = await client.forgetMemory(content)
          return {
            content: [{ type: "text" as const, text: `${result.message} in container ${result.containerTag}` }],
          }
        }

        const result = await client.createMemory(content)
        return {
          content: [{ type: "text" as const, text: `Saved memory (id: ${result.id}) in ${result.containerTag} project` }],
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "An unexpected error occurred"
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        }
      }
    },
  )

  // ─── Recall Tool ─────────────────────────────────────────────────
  server.tool(
    "recall",
    "Search the user's memories. Returns relevant memories plus their profile summary.",
    {
      query: z
        .string()
        .max(1000, "Query exceeds maximum length of 1,000 characters")
        .describe("The search query to find relevant memories"),
      includeProfile: z.boolean().optional().default(true),
      ...(hasRootContainerTag ? {} : containerTagField),
    },
    async (args) => {
      const { query, includeProfile = true } = args
      const effectiveContainerTag = (args as any).containerTag || props.containerTag
      const client = getClient(props, effectiveContainerTag)

      try {
        if (includeProfile) {
          const profileResult = await client.getProfile(query)
          const parts: string[] = []

          if (profileResult.profile.static.length > 0 || profileResult.profile.dynamic.length > 0) {
            parts.push("## User Profile")
            if (profileResult.profile.static.length > 0) {
              parts.push("**Stable facts:**")
              for (const fact of profileResult.profile.static) {
                parts.push(`- ${fact}`)
              }
            }
            if (profileResult.profile.dynamic.length > 0) {
              parts.push("\n**Recent context:**")
              for (const fact of profileResult.profile.dynamic) {
                parts.push(`- ${fact}`)
              }
            }
          }

          if (profileResult.searchResults?.results.length) {
            parts.push("\n## Relevant Memories")
            for (const [i, memory] of profileResult.searchResults.results.entries()) {
              parts.push(`\n### Memory ${i + 1} (${Math.round(memory.similarity * 100)}% match)`)
              if (memory.title) parts.push(`**${memory.title}**`)
              parts.push(getMemoryText(memory))
            }
          }

          return {
            content: [{ type: "text" as const, text: parts.length > 0 ? parts.join("\n") : "No memories or profile found." }],
          }
        }

        const searchResult = await client.search(query, 10)

        if (searchResult.results.length === 0) {
          return { content: [{ type: "text" as const, text: "No memories found." }] }
        }

        const parts = ["## Relevant Memories"]
        for (const [i, memory] of searchResult.results.entries()) {
          parts.push(`\n### Memory ${i + 1} (${Math.round(memory.similarity * 100)}% match)`)
          if (memory.title) parts.push(`**${memory.title}**`)
          parts.push(getMemoryText(memory))
        }

        return { content: [{ type: "text" as const, text: parts.join("\n") }] }
      } catch (error) {
        const message = error instanceof Error ? error.message : "An unexpected error occurred"
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        }
      }
    },
  )

  // ─── List Projects Tool ──────────────────────────────────────────
  server.tool(
    "listProjects",
    "List all available projects for organizing memories.",
    {
      refresh: z.boolean().optional().default(true).describe("Refresh from server"),
    },
    async () => {
      try {
        const client = getClient(props)
        const projects = await client.getProjects()

        if (projects.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No projects found. Memories will use the default project." }],
          }
        }

        return {
          content: [{ type: "text" as const, text: `Available projects:\n${projects.map((p) => `- ${p}`).join("\n")}` }],
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "An unexpected error occurred"
        return {
          content: [{ type: "text" as const, text: `Error listing projects: ${message}` }],
          isError: true,
        }
      }
    },
  )

  // ─── Who Am I Tool ───────────────────────────────────────────────
  server.tool(
    "whoAmI",
    "Get the current logged-in user's information",
    {},
    async () => {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              userId: props.userId,
              email: props.email,
              name: props.name,
            }),
          },
        ],
      }
    },
  )

  // ─── Convert Document Tool ───────────────────────────────────────
  server.tool(
    "convert-document",
    "Convert a document URL to Markdown. Supports HTML, PDF, DOCX, XLSX, PPTX, and more.",
    {
      url: z.string().url().describe("URL of the document to convert"),
    },
    async (args) => {
      try {
        const response = await fetch(`${env.API_URL}/api/convert`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${props.apiKey}`,
          },
          body: JSON.stringify({ url: args.url }),
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Unknown error" }))
          return {
            content: [{ type: "text" as const, text: `Error converting document: ${(errorData as any).error || response.statusText}` }],
            isError: true,
          }
        }

        const data = await response.json() as { markdown: string; title?: string }
        const header = data.title ? `# ${data.title}\n\n` : ""
        return {
          content: [{ type: "text" as const, text: `${header}${data.markdown}` }],
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "An unexpected error occurred"
        return {
          content: [{ type: "text" as const, text: `Error converting document: ${message}` }],
          isError: true,
        }
      }
    },
  )

  // ─── Resources ───────────────────────────────────────────────────
  server.resource(
    "User Profile",
    "supermemory://profile",
    async () => {
      const client = getClient(props)
      const profileResult = await client.getProfile()
      const parts: string[] = ["# User Profile\n"]

      if (profileResult.profile.static.length > 0) {
        parts.push("## Stable Preferences")
        for (const fact of profileResult.profile.static) parts.push(`- ${fact}`)
      }
      if (profileResult.profile.dynamic.length > 0) {
        parts.push("\n## Recent Activity")
        for (const fact of profileResult.profile.dynamic) parts.push(`- ${fact}`)
      }

      return {
        contents: [{
          uri: "supermemory://profile",
          mimeType: "text/plain",
          text: parts.length > 1 ? parts.join("\n") : "No profile yet. Start saving memories.",
        }],
      }
    },
  )

  server.resource(
    "My Projects",
    "supermemory://projects",
    async () => {
      const client = getClient(props)
      const projects = await client.getProjects()
      return {
        contents: [{
          uri: "supermemory://projects",
          mimeType: "application/json",
          text: JSON.stringify({ projects }, null, 2),
        }],
      }
    },
  )

  // ─── Context Prompt ──────────────────────────────────────────────
  server.prompt(
    "context",
    "User profile and preferences for system context injection.",
    {
      includeRecent: z.boolean().optional().default(true),
      ...(hasRootContainerTag ? {} : containerTagField),
    },
    async (args) => {
      try {
        const { includeRecent = true } = args
        const ct = (args as any).containerTag
        const client = getClient(props, ct)
        const profileResult = await client.getProfile()

        const parts: string[] = []
        parts.push("**Important:** Whenever the user shares informative facts, preferences, personal details, or any memory-worthy information, use the `memory` tool to save it. This helps maintain context across conversations.")
        parts.push("")

        if (profileResult.profile.static.length > 0) {
          parts.push("## User Context")
          parts.push("**Stable Preferences:**")
          for (const fact of profileResult.profile.static) parts.push(`- ${fact}`)
        }
        if (includeRecent && profileResult.profile.dynamic.length > 0) {
          parts.push("\n**Recent Activity:**")
          for (const fact of profileResult.profile.dynamic) parts.push(`- ${fact}`)
        }

        const contextText = parts.length > 2
          ? parts.join("\n")
          : parts[0] + "\n\nNo user profile available yet. Start saving memories to build context."

        return {
          messages: [{ role: "user" as const, content: { type: "text" as const, text: contextText } }],
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "An unexpected error occurred"
        return {
          messages: [{ role: "user" as const, content: { type: "text" as const, text: `Error retrieving user context: ${message}` } }],
        }
      }
    },
  )

  return server
}

/**
 * Get or create a session (server + transport pair).
 */
async function getOrCreateSession(props: UserProps): Promise<SessionEntry> {
  const sessionKey = getSessionKey(props)
  let entry = sessions.get(sessionKey)

  if (!entry) {
    const server = createMcpServer(props)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionKey,
    })

    await server.connect(transport)

    entry = { server, transport }
    sessions.set(sessionKey, entry)
  }

  return entry
}

/**
 * Handle an incoming MCP request via Streamable HTTP transport.
 */
export async function handleMcpRequest(c: Context, props: UserProps) {
  const { transport } = await getOrCreateSession(props)
  return transport.handleRequest(c.req.raw)
}
