import { pgTable, varchar, text, bigint, integer, doublePrecision, jsonb } from "drizzle-orm/pg-core";

/**
 * 1. Threads Table:
 * Represents isolated conversational research sessions with checkpoint metadata.
 */
export const threads = pgTable("threads", {
  id: varchar("id", { length: 128 }).primaryKey(),
  title: text("title").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  messageCount: integer("message_count").default(0).notNull(),
  sourceCount: integer("source_count").default(0).notNull(),
  kbCount: integer("kb_count").default(0).notNull(),
  lastSnippet: text("last_snippet"),
  summary: text("summary"),
});

/**
 * 2. Messages Table:
 * Stores multi-turn chat history (user prompts and assistant synthesized reports).
 */
export const messages = pgTable("messages", {
  id: varchar("id", { length: 128 }).primaryKey(),
  threadId: varchar("thread_id", { length: 128 })
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 32 }).notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  thinking: text("thinking"),
  report: text("report"),
  iterations: integer("iterations"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

/**
 * 3. Sources Table:
 * Stores Tavily search results collected and deduplicated per thread.
 */
export const sources = pgTable("sources", {
  id: varchar("id", { length: 128 }).primaryKey(),
  threadId: varchar("thread_id", { length: 128 })
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  score: doublePrecision("score"),
  iteration: integer("iteration"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

/**
 * 4. Knowledge Base Table:
 * Stores structured curated entities, courses, documentation, and tags per thread.
 */
export const knowledgeBase = pgTable("knowledge_base", {
  id: varchar("id", { length: 128 }).primaryKey(),
  threadId: varchar("thread_id", { length: 128 })
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url").notNull(),
  title: text("title").notNull(),
  domain: text("domain").notNull(),
  category: varchar("category", { length: 64 }).notNull(),
  summary: text("summary").notNull(),
  keyTopics: jsonb("key_topics").$type<string[]>().default([]).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

/**
 * 5. Execution Traces Table:
 * Logs LangGraph telemetry, node status, and reasoning timestamps per thread.
 */
export const traces = pgTable("traces", {
  id: varchar("id", { length: 128 }).primaryKey(),
  threadId: varchar("thread_id", { length: 128 })
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  node: varchar("node", { length: 128 }).notNull(),
  description: text("description").notNull(),
  time: varchar("time", { length: 64 }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// Infer model types
export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type KnowledgeBase = typeof knowledgeBase.$inferSelect;
export type NewKnowledgeBase = typeof knowledgeBase.$inferInsert;
export type Trace = typeof traces.$inferSelect;
export type NewTrace = typeof traces.$inferInsert;
