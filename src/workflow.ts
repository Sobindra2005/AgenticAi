import { researchGraph, SourceItem, KnowledgeBaseEntry } from "./graphs/index.js";

export type WorkflowEvent =
  | { type: "step_start"; step: "planQuery" | "searchTavily" | "evaluateSufficiency" | "synthesizeReport"; label: string; iteration: number; query?: string }
  | { type: "thinking_chunk"; chunk: string; step?: "planQuery" | "evaluateSufficiency" | "synthesizeReport" | string; iteration?: number }
  | { type: "query_planned"; query: string; iteration: number }
  | { type: "sources_updated"; allSources: SourceItem[]; newSources: SourceItem[]; kbEntries: KnowledgeBaseEntry[]; iteration: number; totalCount: number; newCount: number }
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
export async function* streamResearchWorkflow(input: string, maxIterations: number = 3): AsyncGenerator<WorkflowEvent> {
  const task = input.trim();
  if (!task) {
    throw new Error("Please enter a research topic or question.");
  }

  // Initial event: planning started
  yield {
    type: "step_start",
    step: "planQuery",
    label: "Analyzing research task & planning search strategy...",
    iteration: 1,
  };

  const eventStream = await researchGraph.stream(
    { task, maxIterations },
    { streamMode: ["updates", "messages"] }
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
          const q = (data as any).currentQuery || task;
          queriesHistory.push(q);

          yield {
            type: "query_planned",
            query: q,
            iteration: 1,
          };

          yield {
            type: "step_start",
            step: "searchTavily",
            label: `Searching Tavily for: "${q}"`,
            iteration: 1,
            query: q,
          };
        } else if (nodeName === "searchTavily") {
          accumulatedSources = (data as any).sources || [];
          if (Array.isArray((data as any).knowledgeBase)) {
            accumulatedKB = [...accumulatedKB, ...(data as any).knowledgeBase];
          }

          const newSources = (data as any).newSourcesThisStep || [];
          yield {
            type: "sources_updated",
            allSources: accumulatedSources,
            newSources,
            kbEntries: (data as any).knowledgeBase || [],
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
export async function runWorkflow(input: string): Promise<WorkflowResult> {
  const task = input.trim();
  if (!task) {
    throw new Error("Please enter a research topic or question.");
  }

  const result = await researchGraph.invoke({ task, maxIterations: 2 });

  return {
    input,
    output: result.finalReport || "",
    sources: result.sources || [],
    knowledgeBase: result.knowledgeBase || [],
    queries: result.queriesHistory || [],
    iterations: result.iteration || 1,
  };
}
