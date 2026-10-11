import { StateGraph, START, END } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { ResearchAnnotation, ResearchState } from "./state.js";
import {
    planQueryNode,
    searchTavilyNode,
    evaluateSufficiencyNode,
    synthesizeReportNode,
} from "./nodes.js";

const connectionString = process.env.DATABASE_URL 
// Initialize PostgreSQL checkpointer for graph persistence, time-travel, and HITL
export const checkpointer = PostgresSaver.fromConnString(connectionString!);

/**
 * Conditional router:
 * If the research is marked sufficient or max iterations reached, route to synthesizeReport.
 * Otherwise, loop back to searchTavily with the next planned query.
 */
export const shouldContinue = (state: ResearchState): "synthesizeReport" | "searchTavily" => {
    const isSufficient = state.evaluation?.sufficient ?? false;
    const iteration = state.iteration ?? 1;
    const maxIterations = state.maxIterations ?? 3;

    if (isSufficient || iteration >= maxIterations) {
        console.log(`[Router] Concluding loop. Routing to synthesizeReport (Iteration: ${iteration}/${maxIterations}, Sufficient: ${isSufficient})`);
        return "synthesizeReport";
    }

    console.log(`[Router] Research insufficient. Looping back to searchTavily (Next Iteration: ${iteration}, Query: "${state.currentQuery}")`);
    return "searchTavily";
};

/**
 * Cognitive Intent & Knowledge Router:
 * - If DIRECT_CONVERSATION or ANSWER_FROM_KB: Bypasses web search, routes directly to synthesizeReport.
 * - If SEARCH_KNOWLEDGE_GAP or NEW_TOPIC_RESEARCH: Routes to searchTavily to retrieve live web data.
 */
export const routeAfterPlanning = (state: ResearchState): "synthesizeReport" | "searchTavily" => {
    if (state.route === "DIRECT_CONVERSATION" || state.route === "ANSWER_FROM_KB") {
        console.log(`[Router] No web search needed (${state.route}). Routing directly to synthesizeReport!`);
        return "synthesizeReport";
    }

    console.log(`[Router] Web search needed (${state.route}). Routing to searchTavily with query: "${state.currentQuery}"`);
    return "searchTavily";
};

// Build and compile the LangGraph workflow with PostgreSQL checkpointer
export const researchGraph = new StateGraph(ResearchAnnotation)
    .addNode("planQuery", planQueryNode)
    .addNode("searchTavily", searchTavilyNode)
    .addNode("evaluateSufficiency", evaluateSufficiencyNode)
    .addNode("synthesizeReport", synthesizeReportNode)
    .addEdge(START, "planQuery")
    .addConditionalEdges("planQuery", routeAfterPlanning, {
        synthesizeReport: "synthesizeReport",
        searchTavily: "searchTavily",
    })
    .addEdge("searchTavily", "evaluateSufficiency")
    .addConditionalEdges("evaluateSufficiency", shouldContinue, {
        synthesizeReport: "synthesizeReport",
        searchTavily: "searchTavily",
    })
    .addEdge("synthesizeReport", END)
    .compile({ checkpointer });

export * from "./state.js";
export * from "./nodes.js";