import { Request, Response } from "express";
import { ThreadService } from "../services/thread.service.js";

export const ThreadController = {
  /**
   * GET /api/threads
   * Fetch all threads ordered by last updated.
   */
  async getAllThreads(_req: Request, res: Response) {
    try {
      const threads = await ThreadService.getAll();
      return res.json({ threads });
    } catch (error) {
      console.error("[ThreadController.getAllThreads]", error);
      return res.status(500).json({ error: (error as Error).message });
    }
  },

  /**
   * POST /api/threads
   * Create a new research thread.
   */
  async createThread(req: Request, res: Response) {
    try {
      const id = req.body.id ? String(req.body.id) : undefined;
      const title = String(req.body.title || "New Research Thread");
      const thread = await ThreadService.create(id, title);
      return res.json({ success: true, thread });
    } catch (error) {
      console.error("[ThreadController.createThread]", error);
      return res.status(500).json({ error: (error as Error).message });
    }
  },

  /**
   * GET /api/threads/:id
   * Fetch complete thread details (with initial paginated messages, sources, knowledge base, traces).
   * Query params: limit (default 15, pass 0 for all)
   */
  async getThreadById(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const limitParam = req.query.limit;
      const limit = limitParam !== undefined ? parseInt(String(limitParam), 10) : 15;
      const data = await ThreadService.getFullData(id, {
        messageLimit: isNaN(limit) ? 15 : limit,
      });
      if (!data.thread) {
        return res.status(404).json({ error: `Thread "${id}" not found.` });
      }
      return res.json(data);
    } catch (error) {
      console.error("[ThreadController.getThreadById]", error);
      return res.status(500).json({ error: (error as Error).message });
    }
  },

  /**
   * GET /api/threads/:id/messages
   * Fetch older/paginated messages on demand for a thread.
   * Query params: limit (default 15), before (message UUID or ISO date cursor)
   */
  async getThreadMessages(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const limitParam = req.query.limit;
      const limit = limitParam !== undefined ? parseInt(String(limitParam), 10) : 15;
      const before = req.query.before ? String(req.query.before) : undefined;

      const result = await ThreadService.getMessagesPaginated(id, {
        limit: isNaN(limit) ? 15 : limit,
        before,
      });

      return res.json(result);
    } catch (error) {
      console.error("[ThreadController.getThreadMessages]", error);
      return res.status(500).json({ error: (error as Error).message });
    }
  },

  /**
   * GET /api/threads/:id/sources
   * Fetch isolated sources list for a thread without blocking other assets.
   */
  async getThreadSources(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const sources = await ThreadService.getSources(id);
      return res.json({ sources });
    } catch (error) {
      console.error("[ThreadController.getThreadSources]", error);
      return res.status(500).json({ error: (error as Error).message });
    }
  },

  /**
   * GET /api/threads/:id/kb
   * Fetch isolated knowledge base entries for a thread without blocking other assets.
   */
  async getThreadKb(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const kb = await ThreadService.getKb(id);
      return res.json({ kb });
    } catch (error) {
      console.error("[ThreadController.getThreadKb]", error);
      return res.status(500).json({ error: (error as Error).message });
    }
  },

  /**
   * GET /api/threads/:id/traces
   * Fetch isolated telemetry traces for a thread without blocking other assets.
   */
  async getThreadTraces(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const traces = await ThreadService.getTraces(id);
      return res.json({ traces });
    } catch (error) {
      console.error("[ThreadController.getThreadTraces]", error);
      return res.status(500).json({ error: (error as Error).message });
    }
  },

  /**
   * PUT /api/threads/:id
   * Update thread metadata (title, summary, last snippet).
   */
  async updateThread(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const updates = req.body;
      const thread = await ThreadService.updateMeta(id, updates);
      if (!thread) {
        return res.status(404).json({ error: `Thread "${id}" not found.` });
      }
      return res.json({ success: true, thread });
    } catch (error) {
      console.error("[ThreadController.updateThread]", error);
      return res.status(500).json({ error: (error as Error).message });
    }
  },

  /**
   * POST /api/threads/:id/save
   * Save sources, knowledge base cards, and trace steps for a thread.
   */
  async saveThreadAssets(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const { sources, kb, trace } = req.body;
      await ThreadService.saveBatchAssets(id, sources || [], kb || [], trace || []);
      return res.json({ success: true });
    } catch (error) {
      console.error("[ThreadController.saveThreadAssets]", error);
      return res.status(500).json({ error: (error as Error).message });
    }
  },

  /**
   * DELETE /api/threads/:id
   * Delete thread and all associated messages, sources, and traces.
   */
  async deleteThread(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const deleted = await ThreadService.delete(id);
      return res.json({ success: deleted });
    } catch (error) {
      console.error("[ThreadController.deleteThread]", error);
      return res.status(500).json({ error: (error as Error).message });
    }
  },

  /**
   * POST /api/threads/:id/clear
   * Clear all messages and assets for a thread while keeping the thread record.
   */
  async clearThread(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      await ThreadService.clearThread(id);
      return res.json({ success: true });
    } catch (error) {
      console.error("[ThreadController.clearThread]", error);
      return res.status(500).json({ error: (error as Error).message });
    }
  },

  /**
   * PUT /api/threads/:id/messages/:messageId/report
   * Updates an assistant message's report content (e.g. after repairing a Mermaid diagram).
   */
  async updateMessageReport(req: Request, res: Response) {
    try {
      const messageId = String(req.params.messageId);
      const { report } = req.body;
      if (!report) {
        return res.status(400).json({ error: "report is required" });
      }
      const success = await ThreadService.updateMessageReport(messageId, String(report));
      return res.json({ success });
    } catch (error) {
      console.error("[ThreadController.updateMessageReport]", error);
      return res.status(500).json({ error: (error as Error).message });
    }
  },
};
