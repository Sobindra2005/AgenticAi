import { Annotation } from "@langchain/langgraph";

export const ResearchAnnotation = Annotation.Root({
    // 1. Initial user request (read-only input)
    task: Annotation<string>,
    // 2. Query produced by planQueryNode (overwritten)
    search_query: Annotation<string>,
    // 3. Raw results from Tavily (overwritten or accumulated)
    search_results: Annotation<Array<{ title: string; url: string; content: string }>>({
        reducer: (prev, next) => next, // replaces on update
        default: () => [],
    }),
    // 4. Final synthesized response
    final_report: Annotation<string>,
});


// Extract the TypeScript type automatically:
export type ResearchState = typeof ResearchAnnotation.State;