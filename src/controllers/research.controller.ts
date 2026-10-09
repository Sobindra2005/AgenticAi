import { Request, Response } from "express";
import { runWorkflow, streamResearchWorkflow } from "../workflow.js";

export const ResearchController = {
  /**
   * GET /
   * Renders the Research Studio main view.
   */
  renderStudio(_req: Request, res: Response) {
    res.render("index", {
      title: "Agentic AI - Iterative Research Studio",
      input: "",
      result: null,
      error: null,
    });
  },

  /**
   * GET /api/stream
   * Streams research execution steps, reasoning tokens, and final synthesis via SSE.
   */
  async streamResearch(req: Request, res: Response) {
    const input = String(req.query.input ?? "").trim();
    const threadId = String(req.query.threadId ?? "").trim();

    if (!input) {
      return res.status(400).json({ error: "Input prompt is required." });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      const generator = streamResearchWorkflow(input, 3, threadId);
      for await (const event of generator) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      res.end();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.write(`data: ${JSON.stringify({ type: "error", error: errorMessage })}\n\n`);
      res.end();
    }
  },

  /**
   * GET /api/run
   * Synchronously executes research workflow and returns JSON result.
   */
  async apiRun(req: Request, res: Response) {
    try {
      const input = String(req.query.input ?? "").trim();
      const result = await runWorkflow(input);
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  },

  /**
   * POST /run
   * Traditional form post submission handler.
   */
  async formRun(req: Request, res: Response) {
    const input = String(req.body.input ?? "").trim();
    try {
      const result = await runWorkflow(input);
      res.render("index", {
        title: "Agentic AI - Iterative Research Studio",
        input,
        result,
        error: null,
      });
    } catch (error) {
      res.status(500).render("index", {
        title: "Agentic AI - Iterative Research Studio",
        input,
        result: null,
        error: error instanceof Error ? error.message : "Workflow execution failed.",
      });
    }
  },
};
