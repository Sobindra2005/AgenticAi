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
    console.error("[Database] ❌ PostgreSQL connection failed:", (error as Error).message);
    throw error;
  }
}
