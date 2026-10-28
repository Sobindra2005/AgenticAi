import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../models/schema.js";

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/agentic_ai";

// Initialize Postgres client
export const pgClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: (notice) => {
    // Ignore benign notices (e.g. 42P06: schema already exists, 42P07: relation already exists)
    if (notice.code === "42P06" || notice.code === "42P07") return;
    console.info(`[Database Notice] ${notice.message}`);
  },
});

// Initialize Drizzle ORM with models schema
export const db = drizzle(pgClient, { schema });

/**
 * Verifies PostgreSQL connectivity on server startup.
 */
export async function checkDatabaseConnection(): Promise<void> {
  try {
    await pgClient`SELECT 1`;
    console.log("[Database] ✓ Connected to PostgreSQL via Drizzle ORM.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Database] ❌ PostgreSQL connection failed:", message);
    throw error;
  }
}
