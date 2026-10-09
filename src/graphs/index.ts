import { StateGraph, START, END } from "@langchain/langgraph";
import { ResearchAnnotation, ResearchState } from "./state.js";
import {
    planQueryNode,
    searchTavilyNode,
    evaluateSufficiencyNode,
    synthesizeReportNode,
} from "./nodes.js";

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

// Build and compile the LangGraph workflow
export const researchGraph = new StateGraph(ResearchAnnotation)
    .addNode("planQuery", planQueryNode)
    .addNode("searchTavily", searchTavilyNode)
    .addNode("evaluateSufficiency", evaluateSufficiencyNode)
    .addNode("synthesizeReport", synthesizeReportNode)
    .addEdge(START, "planQuery")
    .addEdge("planQuery", "searchTavily")
    .addEdge("searchTavily", "evaluateSufficiency")
    .addConditionalEdges("evaluateSufficiency", shouldContinue, {
        synthesizeReport: "synthesizeReport",
        searchTavily: "searchTavily",
    })
    .addEdge("synthesizeReport", END)
    .compile();

export * from "./state.js";
export * from "./nodes.js";
