import { HumanMessage } from "@langchain/core/messages";
import { researchGraph, SourceItem, KnowledgeBaseEntry } from "./graphs/index.js";
import { ThreadService } from "./services/thread.service.js";

export type WorkflowEvent =
  | { type: "step_start"; step: "planQuery" | "searchTavily" | "evaluateSufficiency" | "synthesizeReport"; label: string; iteration: number; query?: string }
  | { type: "thinking_chunk"; chunk: string; step?: "planQuery" | "evaluateSufficiency" | "synthesizeReport" | string; iteration?: number }
  | { type: "query_planned"; query: string; iteration: number }
  | { type: "sources_updated"; allSources: SourceItem[]; newSources: SourceItem[]; kbEntries?: KnowledgeBaseEntry[]; iteration: number; totalCount: number; newCount: number }
  | { type: "eval_decision"; sufficient: boolean; reason: string; nextQuery?: string; iteration: number }
  | { type: "report_chunk"; chunk: string }
  | { type: "done"; finalReport: string; sources: SourceItem[]; knowledgeBase: KnowledgeBaseEntry[]; queries: string[]; iterations: number };

export type WorkflowResult = {
  input: string;
  output: string;
  sources: SourceItem[];
  knowledgeBase: KnowledgeBaseEntry[];
  queries: string[];
  iterations: number;
};

/**
 * Executes the iterative research graph and yields typed streaming events
 * for real-time frontend visualization.
 */
export async function* streamResearchWorkflow(
  input: string,
  maxIterations: number = 3,
  threadId?: string
): AsyncGenerator<WorkflowEvent> {
  const task = input.trim();
  if (!task) {
    throw new Error("Please enter a research topic or question.");
  }

  if (threadId) {
    console.log(`[streamResearchWorkflow] Running research for Thread ID: "${threadId}"`);
    try {
      await ThreadService.addMessage(threadId, "user", task);
    } catch (e) {
      console.error("[streamResearchWorkflow] Failed to record user message:", e);
    }
  }

  const effectiveThreadId = threadId || `adhoc-${Date.now()}`;

  // Checkpointer debug: inspect what PostgreSQL restored for this thread
  try {
    const existingState = await researchGraph.getState({
      configurable: { thread_id: effectiveThreadId },
    });
    const hasPriorState = Boolean(
      existingState?.values && Object.keys(existingState.values).length > 0
    );
    console.log(`\n============================================================`);
    console.log(`[Checkpointer Debug] Thread ID: "${effectiveThreadId}"`);
    console.log(`[Checkpointer Debug] Has prior Postgres checkpoint? ${hasPriorState}`);
    if (hasPriorState) {
      const vals = existingState.values as any;
      console.log(`[Checkpointer Debug]   - Restored Sources count: ${vals.sources?.length ?? 0}`);
      console.log(`[Checkpointer Debug]   - Restored KB cards count: ${vals.knowledgeBase?.length ?? 0}`);
      console.log(`[Checkpointer Debug]   - Restored Messages count: ${vals.messages?.length ?? 0}`);
      if (vals.conversationSummary) {
        console.log(`[Checkpointer Debug]   - Restored Thread Summary: "${vals.conversationSummary}"`);
      }
      console.log(`[Checkpointer Debug]   - Restored Queries History:`, vals.queriesHistory ?? []);
      console.log(`[Checkpointer Debug]   - Previous Task: "${vals.task ?? ""}"`);
    } else {
      console.log(`[Checkpointer Debug]   - Fresh thread (no prior checkpoints found).`);
    }
    console.log(`============================================================\n`);
  } catch (err) {
    console.warn(`[Checkpointer Debug] Notice:`, (err as Error).message);
  }

  // Initial event: planning started
  yield {
    type: "step_start",
    step: "planQuery",
    label: "Analyzing research task & planning search strategy...",
    iteration: 1,
  };

  const eventStream = await researchGraph.stream(
    { task, maxIterations, messages: [new HumanMessage(task)] },
    {
      streamMode: ["updates", "messages"],
      configurable: { thread_id: effectiveThreadId },
    }
  );

  let accumulatedSources: SourceItem[] = [];
  let accumulatedKB: KnowledgeBaseEntry[] = [];
  let queriesHistory: string[] = [];
  let currentIteration = 1;
  let finalReport = "";
  let accumulatedReport = "";

  const thinkingHeadersEmitted = new Set<string>();

  for await (const chunk of eventStream) {
    let mode: string;
    let payload: any;

    if (Array.isArray(chunk) && typeof chunk[0] === "string") {
      mode = chunk[0];
      payload = chunk[1];
    } else if (chunk && typeof chunk === "object") {
      mode = "updates";
      payload = chunk;
    } else {
      continue;
    }

    // 1. Handle "messages" mode (streaming tokens in real time)
    if (mode === "messages") {
      const [messageChunk, metadata] = Array.isArray(payload) ? payload : [payload, {}];
      const nodeName = metadata?.langgraph_node || "";

      // Reasoning token delivered directly by LangChain (Ollama / Groq)
      const reasoningToken: string =
        (messageChunk?.additional_kwargs as any)?.reasoning_content ||
        (messageChunk?.additional_kwargs as any)?.thinking ||
        "";

      // Content token with any stray <think> tags stripped
      let contentToken: string = typeof messageChunk?.content === "string" ? messageChunk.content : "";
      contentToken = contentToken.replace(/<\/?think>/gi, "");

      // Stream thinking tokens
      if (reasoningToken) {
        const headerKey = `${nodeName}-${currentIteration}`;
        if (!thinkingHeadersEmitted.has(headerKey)) {
          thinkingHeadersEmitted.add(headerKey);
          let header = "";
          if (nodeName === "planQuery") {
            header = `[Planning Strategy - Round ${currentIteration}]\n`;
          } else if (nodeName === "evaluateSufficiency") {
            header = `\n[Evaluating Sources - Round ${currentIteration}]\n`;
          } else if (nodeName === "synthesizeReport") {
            header = `\n[Synthesizing Final Report]\n`;
          }
          if (header) {
            yield {
              type: "thinking_chunk",
              chunk: header,
              step: nodeName,
              iteration: currentIteration,
            };
          }
        }

        yield {
          type: "thinking_chunk",
          chunk: reasoningToken,
          step: nodeName,
          iteration: currentIteration,
        };
      }

      // Stream report content during synthesis in real time
      if (nodeName === "synthesizeReport" && contentToken) {
        accumulatedReport += contentToken;
        yield {
          type: "report_chunk",
          chunk: accumulatedReport,
        };
      }

      continue;
    }

    // 2. Handle "updates" mode (node state transitions)
    if (mode === "updates") {
      const updatesObj = payload as Record<string, any>;
      for (const [nodeName, data] of Object.entries(updatesObj)) {
        if (!data || typeof data !== "object") continue;

        if (nodeName === "planQuery") {
          const route = (data as any).route;
          const reason = (data as any).routingReason || "";
          const q = (data as any).currentQuery;

          if (route === "DIRECT_CONVERSATION" || route === "ANSWER_FROM_KB") {
            const label = route === "ANSWER_FROM_KB"
              ? `Answering directly from Knowledge Base in memory (${reason})`
              : `Responding directly (${reason})`;

            yield {
              type: "step_start",
              step: "synthesizeReport",
              label,
              iteration: 1,
            };
          } else {
            const searchQ = q || task;
            queriesHistory.push(searchQ);

            yield {
              type: "query_planned",
              query: searchQ,
              iteration: 1,
            };

            yield {
              type: "step_start",
              step: "searchTavily",
              label: `Searching Tavily for: "${searchQ}"`,
              iteration: 1,
              query: searchQ,
            };
          }
        } else if (nodeName === "searchTavily") {
          accumulatedSources = (data as any).sources || [];
          const newSources = (data as any).newSourcesThisStep || [];

          yield {
            type: "sources_updated",
            allSources: accumulatedSources,
            newSources,
            iteration: currentIteration,
            totalCount: accumulatedSources.length,
            newCount: newSources.length,
          };

          yield {
            type: "step_start",
            step: "evaluateSufficiency",
            label: `Evaluating research depth (${accumulatedSources.length} sources collected)...`,
            iteration: currentIteration,
          };
        } else if (nodeName === "evaluateSufficiency") {
          const isSufficient = (data as any).evaluation?.sufficient ?? false;
          const reason = (data as any).evaluation?.reason ?? "";
          const nextQuery = (data as any).evaluation?.nextQuery;

          yield {
            type: "eval_decision",
            sufficient: isSufficient,
            reason,
            nextQuery,
            iteration: currentIteration,
          };

          if (!isSufficient && nextQuery) {
            currentIteration = (data as any).iteration || (currentIteration + 1);
            queriesHistory.push(nextQuery);

            yield {
              type: "step_start",
              step: "searchTavily",
              label: `Refining research with deeper query: "${nextQuery}"`,
              iteration: currentIteration,
              query: nextQuery,
            };
          } else {
            yield {
              type: "step_start",
              step: "synthesizeReport",
              label: "Synthesizing comprehensive final report & curating Knowledge Base...",
              iteration: currentIteration,
            };
          }
        } else if (nodeName === "synthesizeReport") {
          finalReport = (data as any).finalReport || accumulatedReport || "";
          yield {
            type: "report_chunk",
            chunk: finalReport,
          };
        }
      }
    }
  }

  // Persist assistant response and gathered assets to PostgreSQL via Drizzle
  if (threadId) {
    const completeReport = finalReport || accumulatedReport;
    try {
      await ThreadService.addMessage(threadId, "assistant", completeReport, {
        report: completeReport,
        iterations: currentIteration,
      });
      await ThreadService.saveBatchAssets(threadId, accumulatedSources, accumulatedKB);
    } catch (e) {
      console.error("[streamResearchWorkflow] Failed to persist thread completion to database:", e);
    }
  }

  // Final completion event
  yield {
    type: "done",
    finalReport: finalReport || accumulatedReport,
    sources: accumulatedSources,
    knowledgeBase: accumulatedKB,
    queries: queriesHistory,
    iterations: currentIteration,
  };
}

/**
 * Standard non-streaming workflow execution
 */
export async function runWorkflow(input: string, threadId?: string): Promise<WorkflowResult> {
  const task = input.trim();
  if (!task) {
    throw new Error("Please enter a research topic or question.");
  }

  const effectiveThreadId = threadId || `adhoc-${Date.now()}`;
  const result = await researchGraph.invoke(
    { task, maxIterations: 2, messages: [new HumanMessage(task)] },
    { configurable: { thread_id: effectiveThreadId } }
  );

  return {
    input,
    output: result.finalReport || "",
    sources: result.sources || [],
    knowledgeBase: result.knowledgeBase || [],
    queries: result.queriesHistory || [],
    iterations: result.iteration || 1,
  };
}
