import { serve } from "@hono/node-server"
import { cors } from "hono/cors"
import { Hono } from "hono"
import { env } from "./env.js"
import { createMcpServer, handleMcpRequest } from "./server.js"
import { isApiKey, validateApiKey, validateOAuthToken } from "./auth.js"
import { createLogger } from "@repo/lib/logger"

const logger = createLogger("mcp-index")

const app = new Hono()

// CORS
app.use(
	"*",
	cors({
		origin: "*",
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization", "x-sm-project"],
	}),
)

// Health / info
app.get("/", (c) => {
	return c.json({
		name: "funes-mcp",
		version: "4.0.0",
		description: "Give your AI a memory — self-hosted",
		docs: "https://github.com/MorkMindy74/Funes",
	})
})

// OAuth discovery endpoints
app.get("/.well-known/oauth-protected-resource", (c) => {
	const resourceUrl = `http://localhost:${env.PORT}`
	return c.json({
		resource: resourceUrl,
		authorization_servers: [env.API_URL],
		scopes_supported: ["openid", "profile", "email", "offline_access"],
		bearer_methods_supported: ["header"],
		resource_documentation: "https://github.com/MorkMindy74/Funes",
	})
})

app.get("/.well-known/oauth-authorization-server", async (c) => {
	try {
		const response = await fetch(
			`${env.API_URL}/.well-known/oauth-authorization-server`,
		)
		if (!response.ok) {
			return c.json(
				{ error: "Failed to fetch authorization server metadata" },
				response.status as any,
			)
		}
		const metadata = await response.json()
		return c.json(metadata)
	} catch (error) {
		logger.error("Error fetching OAuth metadata", {
			error: error instanceof Error ? error.message : error,
		})
		return c.json({ error: "Internal server error" }, 500)
	}
})

// MCP endpoint — authenticate then handle
app.all("/mcp", async (c) => {
	const authHeader = c.req.header("Authorization")
	const token = authHeader?.replace(/^Bearer\s+/i, "")
	const containerTag = c.req.header("x-sm-project")

	if (!token) {
		return c.json(
			{
				jsonrpc: "2.0",
				error: { code: -32000, message: "Unauthorized: No token provided" },
				id: null,
			},
			401,
		)
	}

	let authUser: {
		userId: string
		apiKey: string
		email?: string
		name?: string
	} | null = null

	if (isApiKey(token)) {
		logger.info("Authenticating with API key")
		authUser = await validateApiKey(token, env.API_URL)
	} else {
		logger.info("Authenticating with OAuth token")
		authUser = await validateOAuthToken(token, env.API_URL)
	}

	if (!authUser) {
		return c.json(
			{
				jsonrpc: "2.0",
				error: {
					code: -32000,
					message: "Unauthorized: Invalid or expired token",
				},
				id: null,
			},
			401,
		)
	}

	// Handle MCP request
	return handleMcpRequest(c, {
		userId: authUser.userId,
		apiKey: authUser.apiKey,
		containerTag,
		email: authUser.email,
		name: authUser.name,
	})
})

// SSE endpoint for streaming MCP
app.get("/mcp/sse", async (c) => {
	const authHeader = c.req.header("Authorization")
	const token = authHeader?.replace(/^Bearer\s+/i, "")
	const containerTag = c.req.header("x-sm-project")

	if (!token) {
		return c.json({ error: "Unauthorized" }, 401)
	}

	let authUser: {
		userId: string
		apiKey: string
		email?: string
		name?: string
	} | null = null
	if (isApiKey(token)) {
		authUser = await validateApiKey(token, env.API_URL)
	} else {
		authUser = await validateOAuthToken(token, env.API_URL)
	}

	if (!authUser) {
		return c.json({ error: "Unauthorized" }, 401)
	}

	return handleMcpRequest(c, {
		userId: authUser.userId,
		apiKey: authUser.apiKey,
		containerTag,
		email: authUser.email,
		name: authUser.name,
	})
})

// Start server
logger.info(`Starting Funes MCP server on port ${env.PORT}...`)

serve(
	{
		fetch: app.fetch,
		port: env.PORT,
	},
	(info) => {
		logger.info(`Funes MCP server running at http://localhost:${info.port}`)
		logger.info(`MCP endpoint: http://localhost:${info.port}/mcp`)
	},
)

export default app
