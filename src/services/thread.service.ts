import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import * as models from "../models/index.js";
import { SourceItem, KnowledgeBaseEntry } from "../graphs/state.js";

export const ThreadService = {
  /**
   * Retrieves all threads sorted by most recently updated.
   */
  async getAll(): Promise<models.Thread[]> {
    return await db
      .select()
      .from(models.threads)
      .orderBy(desc(models.threads.updatedAt));
  },

  /**
   * Retrieves a single thread by its ID.
   */
  async getById(id: string): Promise<models.Thread | undefined> {
    const rows = await db
      .select()
      .from(models.threads)
      .where(eq(models.threads.id, id));
    return rows[0];
  },

  /**
   * Creates a new thread record.
   */
  async create(id: string, initialTitle: string = "New Research Thread"): Promise<models.Thread> {
    const now = Date.now();
    const newRecord: models.NewThread = {
      id,
      title: initialTitle,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      sourceCount: 0,
      kbCount: 0,
      lastSnippet: "Fresh research thread ready.",
    };

    await db.insert(models.threads).values(newRecord).onConflictDoNothing();
    const existing = await this.getById(id);
    return existing || (newRecord as models.Thread);
  },

  /**
   * Updates metadata (e.g. title, summary, lastSnippet) for a thread.
   */
  async updateMeta(id: string, updates: Partial<models.Thread>): Promise<models.Thread | undefined> {
    const updatedPayload = { ...updates, updatedAt: Date.now() };
    await db
      .update(models.threads)
      .set(updatedPayload)
      .where(eq(models.threads.id, id));
    return await this.getById(id);
  },

  /**
   * Deletes a thread and cascades all related messages, sources, and traces.
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(models.threads)
      .where(eq(models.threads.id, id));
    return true;
  },

  /**
   * Fetches full thread data including all messages, sources, KB entries, and traces.
   */
  async getFullData(id: string) {
    const [threadList, messagesList, sourcesList, kbList, tracesList] =
      await Promise.all([
        db.select().from(models.threads).where(eq(models.threads.id, id)),
        db.select().from(models.messages).where(eq(models.messages.threadId, id)),
        db.select().from(models.sources).where(eq(models.sources.threadId, id)),
        db.select().from(models.knowledgeBase).where(eq(models.knowledgeBase.threadId, id)),
        db.select().from(models.traces).where(eq(models.traces.threadId, id)),
      ]);

    return {
      thread: threadList[0],
      messages: messagesList,
      sources: sourcesList.map((s) => ({
        id: s.id,
        url: s.url,
        title: s.title,
        content: s.content,
        score: s.score ?? undefined,
        iteration: s.iteration ?? 1,
      })),
      kb: kbList.map((k) => ({
        id: k.id,
        sourceUrl: k.sourceUrl,
        title: k.title,
        domain: k.domain,
        category: k.category as any,
        summary: k.summary,
        keyTopics: k.keyTopics,
      })),
      traces: tracesList.map((t) => ({
        id: t.id,
        node: t.node,
        desc: t.description,
        time: t.time,
      })),
    };
  },

  /**
   * Appends a message (user or assistant) to a thread in the database.
   */
  async addMessage(
    threadId: string,
    role: "user" | "assistant",
    content: string,
    extra?: { thinking?: string; report?: string; iterations?: number }
  ) {
    await this.create(threadId);

    const msgId = "msg-" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const now = Date.now();

    const newMsg: models.NewMessage = {
      id: msgId,
      threadId,
      role,
      content,
      thinking: extra?.thinking ?? null,
      report: extra?.report ?? null,
      iterations: extra?.iterations ?? 1,
      createdAt: now,
    };

    await db.insert(models.messages).values(newMsg);

    // Update thread metrics
    const currentThread = await this.getById(threadId);
    const count = (currentThread?.messageCount ?? 0) + 1;
    const updates: Partial<models.Thread> = {
      messageCount: count,
      lastSnippet: content.slice(0, 140),
      updatedAt: now,
    };

    if (
      (currentThread?.title === "New Research Thread" || currentThread?.title === "Untitled Thread") &&
      role === "user"
    ) {
      updates.title = content.slice(0, 48);
    }

    await db.update(models.threads).set(updates).where(eq(models.threads.id, threadId));
    return newMsg;
  },

  /**
   * Saves sources, knowledge base entries, and traces in batch directly into PostgreSQL.
   */
  async saveBatchAssets(
    threadId: string,
    sourcesList: SourceItem[],
    kbList: KnowledgeBaseEntry[],
    traceList?: Array<{ node: string; desc: string; time: string }>
  ) {
    await this.create(threadId);
    const now = Date.now();

    if (sourcesList.length > 0) {
      await db.delete(models.sources).where(eq(models.sources.threadId, threadId));
      const sourceRows: models.NewSource[] = sourcesList.map((s) => ({
        id: s.id || "src-" + Math.random().toString(36).substring(2, 9),
        threadId,
        url: s.url,
        title: s.title || "Untitled",
        content: s.content || "",
        score: s.score ?? null,
        iteration: s.iteration ?? 1,
        createdAt: now,
      }));
      await db.insert(models.sources).values(sourceRows);
    }

    if (kbList.length > 0) {
      await db.delete(models.knowledgeBase).where(eq(models.knowledgeBase.threadId, threadId));
      const kbRows: models.NewKnowledgeBase[] = kbList.map((k) => ({
        id: k.id || "kb-" + Math.random().toString(36).substring(2, 9),
        threadId,
        sourceUrl: k.sourceUrl,
        title: k.title,
        domain: k.domain,
        category: k.category,
        summary: k.summary,
        keyTopics: k.keyTopics,
        createdAt: now,
      }));
      await db.insert(models.knowledgeBase).values(kbRows);
    }

    if (traceList && traceList.length > 0) {
      const traceRows: models.NewTrace[] = traceList.map((t) => ({
        id: "tr-" + Math.random().toString(36).substring(2, 9),
        threadId,
        node: t.node,
        description: t.desc,
        time: t.time,
        createdAt: now,
      }));
      await db.insert(models.traces).values(traceRows);
    }

    await db
      .update(models.threads)
      .set({
        sourceCount: sourcesList.length,
        kbCount: kbList.length,
        updatedAt: now,
      })
      .where(eq(models.threads.id, threadId));

    return true;
  },

  /**
   * Clears messages, sources, KB, and traces for a thread while keeping the thread container.
   */
  async clearThread(threadId: string) {
    await Promise.all([
      db.delete(models.messages).where(eq(models.messages.threadId, threadId)),
      db.delete(models.sources).where(eq(models.sources.threadId, threadId)),
      db.delete(models.knowledgeBase).where(eq(models.knowledgeBase.threadId, threadId)),
      db.delete(models.traces).where(eq(models.traces.threadId, threadId)),
      db
        .update(models.threads)
        .set({
          messageCount: 0,
          sourceCount: 0,
          kbCount: 0,
          lastSnippet: "Cleared thread.",
          updatedAt: Date.now(),
        })
        .where(eq(models.threads.id, threadId)),
    ]);
    return true;
  },
};
