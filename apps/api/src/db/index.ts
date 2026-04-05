import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import * as schema from "./schema.js"
import { logger } from "../logger.js"

const { Pool } = pg

const DATABASE_URL =
	process.env.DATABASE_URL ?? "postgres://funes:funes_dev@localhost:5432/funes"

const pool = new Pool({
	connectionString: DATABASE_URL,
	max: 20,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 5000,
})

pool.on("error", (err) => {
	logger.error({ err }, "Unexpected database pool error")
})

export const db = drizzle(pool, { schema })
export type Database = typeof db

export { pool }
