import { eq, desc, asc, lt, and, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import * as models from "../models/index.js";
import { SourceItem, KnowledgeBaseEntry } from "../graphs/state.js";
import { syncKnowledgeBaseVectors } from "./rag.service.js";

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
   * Fetches paginated messages for a given thread with cursor-based pagination.
   * If `before` is provided (UUID or ISO date), fetches messages created before that cursor.
   * Messages are returned in chronological order (asc by createdAt).
   */
  async getMessagesPaginated(
    threadId: string,
    options?: { limit?: number; before?: string }
  ) {
    if (!isValidUUID(threadId)) {
      return {
        messages: [] as models.Message[],
        pagination: { total: 0, hasMore: false, limit: 15, oldestMessageId: null, oldestCreatedAt: null },
      };
    }

    const limit = Math.max(1, Math.min(options?.limit ?? 15, 100));

    // Get total message count
    const totalCountRes = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(models.messages)
      .where(eq(models.messages.threadId, threadId));
    const total = totalCountRes[0]?.count ?? 0;

    let beforeDate: Date | null = null;
    if (options?.before) {
      if (isValidUUID(options.before)) {
        const cursorMsg = await db
          .select({ createdAt: models.messages.createdAt })
          .from(models.messages)
          .where(and(eq(models.messages.threadId, threadId), eq(models.messages.id, options.before)));
        if (cursorMsg[0]) {
          beforeDate = cursorMsg[0].createdAt;
        }
      } else {
        const parsed = new Date(options.before);
        if (!isNaN(parsed.getTime())) {
          beforeDate = parsed;
        }
      }
    }

    const whereClause = beforeDate
      ? and(
          eq(models.messages.threadId, threadId),
          lt(models.messages.createdAt, beforeDate)
        )
      : eq(models.messages.threadId, threadId);

    const rows = await db
      .select()
      .from(models.messages)
      .where(whereClause)
      .orderBy(desc(models.messages.createdAt))
      .limit(limit);

    // Reverse to chronological order (asc)
    const messages = [...rows].reverse();

    // Check if there are more older messages
    let hasMore = false;
    let oldestMessageId: string | null = null;
    let oldestCreatedAt: string | null = null;

    if (messages.length > 0) {
      const oldestInBatch = messages[0];
      oldestMessageId = oldestInBatch.id;
      oldestCreatedAt = oldestInBatch.createdAt.toISOString();

      const olderCheck = await db
        .select({ id: models.messages.id })
        .from(models.messages)
        .where(
          and(
            eq(models.messages.threadId, threadId),
            lt(models.messages.createdAt, oldestInBatch.createdAt)
          )
        )
        .limit(1);

      hasMore = olderCheck.length > 0;
    }

    return {
      messages,
      pagination: {
        total,
        hasMore,
        limit,
        oldestMessageId,
        oldestCreatedAt,
      },
    };
  },

  /**
   * Fetches full thread data including paginated messages, sources, KB entries, and traces.
   * Default messageLimit is 15. Pass 0 to fetch all messages.
   */
  async getFullData(id: string, options?: { messageLimit?: number }) {
    if (!isValidUUID(id)) {
      return {
        thread: undefined,
        messages: [],
        pagination: { total: 0, hasMore: false, limit: 15, oldestMessageId: null, oldestCreatedAt: null },
        sources: [],
        kb: [],
        traces: [],
      };
    }

    const messageLimit = options?.messageLimit !== undefined ? options.messageLimit : 15;

    const [threadList, paginatedResult, sourcesList, kbList, tracesList] =
      await Promise.all([
        db.select().from(models.threads).where(eq(models.threads.id, id)),
        messageLimit === 0
          ? db
              .select()
              .from(models.messages)
              .where(eq(models.messages.threadId, id))
              .orderBy(asc(models.messages.createdAt))
              .then((allMsgs) => ({
                messages: allMsgs,
                pagination: {
                  total: allMsgs.length,
                  hasMore: false,
                  limit: 0,
                  oldestMessageId: allMsgs[0]?.id ?? null,
                  oldestCreatedAt: allMsgs[0]?.createdAt?.toISOString() ?? null,
                },
              }))
          : this.getMessagesPaginated(id, { limit: messageLimit }),
        db.select().from(models.sources).where(eq(models.sources.threadId, id)),
        db.select().from(models.knowledgeBase).where(eq(models.knowledgeBase.threadId, id)),
        db.select().from(models.traces).where(eq(models.traces.threadId, id)).orderBy(asc(models.traces.createdAt)),
      ]);

    return {
      thread: threadList[0],
      messages: paginatedResult.messages,
      pagination: paginatedResult.pagination,
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
   * Fetches isolated sources list for a thread without blocking other assets.
   */
  async getSources(threadId: string) {
    if (!isValidUUID(threadId)) return [];
    const rows = await db
      .select()
      .from(models.sources)
      .where(eq(models.sources.threadId, threadId));
    return rows.map((s) => ({
      id: s.id,
      url: s.url,
      title: s.title,
      content: s.content,
      score: s.score ?? undefined,
      iteration: s.iteration ?? 1,
    }));
  },

  /**
   * Fetches isolated knowledge base entries for a thread without blocking other assets.
   */
  async getKb(threadId: string) {
    if (!isValidUUID(threadId)) return [];
    const rows = await db
      .select()
      .from(models.knowledgeBase)
      .where(eq(models.knowledgeBase.threadId, threadId));
    return rows.map((k) => ({
      id: k.id,
      sourceUrl: k.sourceUrl,
      title: k.title,
      domain: k.domain,
      category: k.category as any,
      summary: k.summary,
      keyTopics: k.keyTopics,
    }));
  },

  /**
   * Fetches isolated graph execution telemetry traces for a thread without blocking other assets.
   */
  async getTraces(threadId: string) {
    if (!isValidUUID(threadId)) return [];
    const rows = await db
      .select()
      .from(models.traces)
      .where(eq(models.traces.threadId, threadId))
      .orderBy(asc(models.traces.createdAt));
    return rows.map((t) => ({
      id: t.id,
      node: t.node,
      desc: t.description,
      time: t.time,
    }));
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

    // 1. Safely merge sources without deleting existing records
    // (Preserves primary keys and prevents onDelete: cascade from wiping knowledge_chunks)
    if (sourceRows.length > 0) {
      const existingSources = await db
        .select({ id: models.sources.id, url: models.sources.url })
        .from(models.sources)
        .where(eq(models.sources.threadId, threadId));

      const existingUrlMap = new Map(existingSources.map((s) => [s.url, s.id]));
      const newSourceRows = sourceRows.filter((s) => !existingUrlMap.has(s.url));

      if (newSourceRows.length > 0) {
        
        await db.insert(models.sources).values(newSourceRows);
      }

      // Refresh content for existing sources in place
      for (const s of sourceRows) {
        const existingId = existingUrlMap.get(s.url);
        if (existingId && s.content && s.content.trim().length > 0) {
          await db
            .update(models.sources)
            .set({
              title: s.title,
              content: s.content,
              score: s.score,
              iteration: s.iteration,
            })
            .where(eq(models.sources.id, existingId));
        }
      }
    }

    if (kbRows.length > 0) {
      await db.delete(models.knowledgeBase).where(eq(models.knowledgeBase.threadId, threadId));
      await db.insert(models.knowledgeBase).values(kbRows);
    }

    if (traceRows.length > 0) {
      await db.delete(models.traces).where(eq(models.traces.threadId, threadId));
      await db.insert(models.traces).values(traceRows);
    }

    const [allDbSources, allDbKb] = await Promise.all([
      db.select({ count: models.sources.id }).from(models.sources).where(eq(models.sources.threadId, threadId)),
      db.select({ count: models.knowledgeBase.id }).from(models.knowledgeBase).where(eq(models.knowledgeBase.threadId, threadId)),
    ]);

    await db
      .update(models.threads)
      .set({
        sourceCount: allDbSources.length,
        kbCount: allDbKb.length,
        updatedAt: new Date(),
      })
      .where(eq(models.threads.id, threadId));

    // 4. Vectorize and synchronize ONLY if Knowledge Base entries were supplied in this batch
    if (kbRows.length > 0) {
      const kbUrls = new Set(kbList.map((k) => k.sourceUrl));
      const kbSourcesMap = new Map<string, SourceItem>();

      for (const s of sourcesList) {
        if (s.url && kbUrls.has(s.url) && s.content) {
          kbSourcesMap.set(s.url, s);
        }
      }

      // If any KB items were not in sourcesList, retrieve full content from DB sources
      if (kbSourcesMap.size < kbUrls.size) {
        const dbSources = await db
          .select()
          .from(models.sources)
          .where(eq(models.sources.threadId, threadId));
        for (const d of dbSources) {
          if (d.url && kbUrls.has(d.url) && !kbSourcesMap.has(d.url) && d.content) {
            kbSourcesMap.set(d.url, {
              id: d.id,
              url: d.url,
              title: d.title,
              content: d.content,
              score: d.score ?? undefined,
              iteration: d.iteration ?? 1,
            });
          }
        }
      }

      try {
        await syncKnowledgeBaseVectors(threadId, Array.from(kbSourcesMap.values()), kbUrls);
      } catch (vErr) {
        console.warn("[ThreadService.saveBatchAssets] Knowledge Base vector sync error:", (vErr as Error).message);
      }
    }

    return true;
  },

  /**
   * Appends newly discovered sources to a thread without touching KB, chunks, or traces.
   * Merges by URL: inserts new sources, updates existing ones if needed.
   */
  async appendSources(threadId: string, sourcesList: SourceItem[]) {
    if (!isValidUUID(threadId) || !sourcesList || sourcesList.length === 0) return;

    await this.create(threadId);

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

    if (sourceRows.length === 0) return;

    const existingSources = await db
      .select({ id: models.sources.id, url: models.sources.url })
      .from(models.sources)
      .where(eq(models.sources.threadId, threadId));

    const existingUrlMap = new Map(existingSources.map((s) => [s.url, s.id]));
    const newSourceRows = sourceRows.filter((s) => !existingUrlMap.has(s.url));

    if (newSourceRows.length > 0) {
      await db.insert(models.sources).values(newSourceRows);
    }

    // Refresh content for existing sources if needed
    for (const s of sourceRows) {
      const existingId = existingUrlMap.get(s.url);
      if (existingId && s.content && s.content.trim().length > 0) {
        await db
          .update(models.sources)
          .set({
            title: s.title,
            content: s.content,
            score: s.score,
            iteration: s.iteration,
          })
          .where(eq(models.sources.id, existingId));
      }
    }

    const totalSources = await db
      .select({ count: models.sources.id })
      .from(models.sources)
      .where(eq(models.sources.threadId, threadId));

    await db
      .update(models.threads)
      .set({
        sourceCount: totalSources.length,
        updatedAt: new Date(),
      })
      .where(eq(models.threads.id, threadId));
  },

  /**
   * Updates an existing message's report and content (e.g. after repairing a Mermaid diagram).
   */
  async updateMessageReport(messageId: string, updatedReport: string) {
    if (!isValidUUID(messageId) || !updatedReport) return false;
    await db
      .update(models.messages)
      .set({
        report: updatedReport,
        content: updatedReport,
      })
      .where(eq(models.messages.id, messageId));
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
      db.delete(models.knowledgeChunks).where(eq(models.knowledgeChunks.threadId, threadId)),
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
