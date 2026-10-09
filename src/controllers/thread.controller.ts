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
      const id = String(
        req.body.id || `th-${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`
      );
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
   * Fetch complete thread details (messages, sources, knowledge base, traces).
   */
  async getThreadById(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const data = await ThreadService.getFullData(id);
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
};
