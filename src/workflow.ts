import { researchGraph, SourceItem, KnowledgeBaseEntry } from "./graphs/index.js";

export type WorkflowEvent =
  | { type: "step_start"; step: "planQuery" | "searchTavily" | "evaluateSufficiency" | "synthesizeReport"; label: string; iteration: number; query?: string }
  | { type: "query_planned"; query: string; iteration: number; thinking?: string }
  | { type: "sources_updated"; allSources: SourceItem[]; newSources: SourceItem[]; kbEntries: KnowledgeBaseEntry[]; iteration: number; totalCount: number; newCount: number }
  | { type: "eval_decision"; sufficient: boolean; reason: string; nextQuery?: string; iteration: number; thinking?: string }
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

  // 1. Initial event: planning started
  yield {
    type: "step_start",
    step: "planQuery",
    label: "Analyzing research task & planning search strategy...",
    iteration: 1,
  };

  const eventStream = await researchGraph.stream(
    { task, maxIterations },
    { streamMode: ["updates","messages"] }
  );

  let accumulatedSources: SourceItem[] = [];
  let accumulatedKB: KnowledgeBaseEntry[] = [];
  let queriesHistory: string[] = [];
  let currentIteration = 1;
  let finalReport = "";

  for await (const chunk of eventStream) {
    const nodeName = Object.keys(chunk)[0];
    const data = (chunk as any)[nodeName];

    if (nodeName === "planQuery") {
      const q = data.currentQuery || task;
      queriesHistory.push(q);

      yield {
        type: "query_planned",
        query: q,
        iteration: 1,
        thinking: data.thinkContent,
      };

      yield {
        type: "step_start",
        step: "searchTavily",
        label: `Searching Tavily for: "${q}"`,
        iteration: 1,
        query: q,
      };
    } else if (nodeName === "searchTavily") {
      accumulatedSources = data.sources || [];
      if (Array.isArray(data.knowledgeBase)) {
        accumulatedKB = [...accumulatedKB, ...data.knowledgeBase];
      }

      const newSources = data.newSourcesThisStep || [];
      yield {
        type: "sources_updated",
        allSources: accumulatedSources,
        newSources,
        kbEntries: data.knowledgeBase || [],
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
      const isSufficient = data.evaluation?.sufficient ?? false;
      const reason = data.evaluation?.reason ?? "";
      const nextQuery = data.evaluation?.nextQuery;

      yield {
        type: "eval_decision",
        sufficient: isSufficient,
        reason,
        nextQuery,
        iteration: currentIteration,
        thinking: data.thinkContent,
      };

      if (!isSufficient && nextQuery) {
        currentIteration = data.iteration || (currentIteration + 1);
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
      finalReport = data.finalReport || "";
      yield {
        type: "report_chunk",
        chunk: finalReport,
      };
    }
  }

  // Final completion event
  yield {
    type: "done",
    finalReport,
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