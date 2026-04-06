import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"

const { Pool } = pg

async function runMigrations() {
	const DATABASE_URL =
		process.env.DATABASE_URL ??
		"postgres://funes:funes_dev@localhost:5432/funes"

	console.log("Running database migrations...")

	const pool = new Pool({ connectionString: DATABASE_URL })
	const db = drizzle(pool)

	try {
		await migrate(db, { migrationsFolder: "./drizzle" })
		console.log("Migrations completed successfully")
	} catch (err) {
		console.error("Migration failed:", err)
		process.exit(1)
	} finally {
		await pool.end()
	}
}

runMigrations()
