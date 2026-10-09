import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import * as models from "../models/index.js";
import { SourceItem, KnowledgeBaseEntry } from "../graphs/state.js";

const isValidUUID = (id?: string): boolean =>
  typeof id === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

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
    if (!isValidUUID(id)) return undefined;
    const rows = await db
      .select()
      .from(models.threads)
      .where(eq(models.threads.id, id));
    return rows[0];
  },

  /**
   * Creates a new thread record. If no valid UUID is passed,
   * PostgreSQL automatically assigns gen_random_uuid().
   */
  async create(id?: string, initialTitle: string = "New Research Thread"): Promise<models.Thread> {
    if (id && isValidUUID(id)) {
      const existing = await this.getById(id);
      if (existing) return existing;
    }

    const payload: Partial<models.NewThread> = {
      title: initialTitle,
      lastSnippet: "Fresh research thread ready.",
    };
    if (id && isValidUUID(id)) {
      payload.id = id;
    }

    const [created] = await db
      .insert(models.threads)
      .values(payload as models.NewThread)
      .returning();

    return created;
  },

  /**
   * Updates metadata (e.g. title, summary, lastSnippet) for a thread.
   */
  async updateMeta(id: string, updates: Partial<models.Thread>): Promise<models.Thread | undefined> {
    if (!isValidUUID(id)) return undefined;
    const { id: _, createdAt: __, ...validUpdates } = updates;
    await db
      .update(models.threads)
      .set({ ...validUpdates, updatedAt: new Date() })
      .where(eq(models.threads.id, id));
    return await this.getById(id);
  },

  /**
   * Deletes a thread and cascades all related messages, sources, and traces.
   */
  async delete(id: string): Promise<boolean> {
    if (!isValidUUID(id)) return false;
    await db
      .delete(models.threads)
      .where(eq(models.threads.id, id));
    return true;
  },

  /**
   * Fetches full thread data including all messages, sources, KB entries, and traces.
   */
  async getFullData(id: string) {
    if (!isValidUUID(id)) {
      return { thread: undefined, messages: [], sources: [], kb: [], traces: [] };
    }

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
   * Auto-assigns id and createdAt via PostgreSQL defaults.
   */
  async addMessage(
    threadId: string,
    role: "user" | "assistant",
    content: string,
    extra?: { thinking?: string; report?: string; iterations?: number }
  ) {
    const thread = await this.create(threadId);
    const validThreadId = thread.id;

    const [newMsg] = await db
      .insert(models.messages)
      .values({
        threadId: validThreadId,
        role,
        content,
        thinking: extra?.thinking ?? null,
        report: extra?.report ?? null,
        iterations: extra?.iterations ?? 1,
      })
      .returning();

    // Update thread metrics
    const currentThread = await this.getById(validThreadId);
    const count = (currentThread?.messageCount ?? 0) + 1;
    const updates: any = {
      messageCount: count,
      lastSnippet: content.slice(0, 140),
      updatedAt: new Date(),
    };

    if (
      (currentThread?.title === "New Research Thread" || currentThread?.title === "Untitled Thread") &&
      role === "user"
    ) {
      updates.title = content.slice(0, 48);
    }

    await db.update(models.threads).set(updates).where(eq(models.threads.id, validThreadId));
    return newMsg;
  },

  /**
   * Saves sources, knowledge base entries, and traces directly into PostgreSQL.
   * PostgreSQL automatically generates random UUIDs for all rows.
   */
  async saveBatchAssets(
    threadId: string,
    sourcesList: SourceItem[],
    kbList: KnowledgeBaseEntry[],
    traceList?: Array<{ node: string; desc: string; time: string }>
  ) {
    if (!isValidUUID(threadId)) {
      console.warn(`[ThreadService.saveBatchAssets] Skipped save for invalid threadId: "${threadId}"`);
      return false;
    }

    await this.create(threadId);

    // 1. Deduplicate sources by URL
    const seenUrls = new Set<string>();
    const sourceRows: models.NewSource[] = [];
    for (const s of sourcesList) {
      if (!s.url || seenUrls.has(s.url)) continue;
      seenUrls.add(s.url);
      sourceRows.push({
        threadId,
        url: s.url,
        title: s.title || "Untitled",
        content: s.content || "",
        score: s.score ?? null,
        iteration: s.iteration ?? 1,
      });
    }

    // 2. Deduplicate KB entries by sourceUrl
    const seenKbUrls = new Set<string>();
    const kbRows: models.NewKnowledgeBase[] = [];
    for (const k of kbList) {
      if (!k.sourceUrl || seenKbUrls.has(k.sourceUrl)) continue;
      seenKbUrls.add(k.sourceUrl);
      kbRows.push({
        threadId,
        sourceUrl: k.sourceUrl,
        title: k.title,
        domain: k.domain,
        category: k.category,
        summary: k.summary,
        keyTopics: k.keyTopics || [],
      });
    }

    // 3. Prepare execution traces
    const traceRows: models.NewTrace[] = (traceList || []).map((t) => ({
      threadId,
      node: t.node,
      description: t.desc,
      time: t.time,
    }));

    // Atomically replace assets for this thread
    if (sourceRows.length > 0) {
      await db.delete(models.sources).where(eq(models.sources.threadId, threadId));
      await db.insert(models.sources).values(sourceRows);
    }

    if (kbRows.length > 0) {
      await db.delete(models.knowledgeBase).where(eq(models.knowledgeBase.threadId, threadId));
      await db.insert(models.knowledgeBase).values(kbRows);
    }

    if (traceRows.length > 0) {
      await db.delete(models.traces).where(eq(models.traces.threadId, threadId));
      await db.insert(models.traces).values(traceRows);
    }

    await db
      .update(models.threads)
      .set({
        sourceCount: sourceRows.length,
        kbCount: kbRows.length,
        updatedAt: new Date(),
      })
      .where(eq(models.threads.id, threadId));

    return true;
  },

  /**
   * Clears messages, sources, KB, and traces for a thread while keeping the thread container.
   */
  async clearThread(threadId: string) {
    if (!isValidUUID(threadId)) return false;
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
          updatedAt: new Date(),
        })
        .where(eq(models.threads.id, threadId)),
    ]);
    return true;
  },
};
