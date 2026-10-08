import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { getLocalLLm } from "../utils.js";
import { ResearchState } from "./state.js";


/**
 * Node responsible for generating an optimized search query 
 * for Tavily based on the current research task.
 */
export const planQueryNode = async (state: ResearchState): Promise<Partial<ResearchState>> => {
    const { task } = state;

    console.log("--- PLANNING SEARCH QUERY ---");

    const llm = getLocalLLm();

    // System instruction to ensure the AI behaves as a query planner
    const systemPrompt = new SystemMessage(`
You are an expert search query generator. 
Your only task is to take the user's research task and output a single, highly optimized search query to be used in the Tavily search engine.
DO NOT output any conversational text, explanations, or quotes. Output ONLY the raw search query.
    `.trim());

    const userPrompt = new HumanMessage(`Research Task: ${task}`);

    const response = await llm.invoke([systemPrompt, userPrompt]);

    // Clean up the output in case the model adds surrounding quotes
    let query = response.content.toString().trim();
    if (query.startsWith('"') && query.endsWith('"')) {
        query = query.slice(1, -1);
    }

    console.log(`Generated Query: "${query}"`);

    // Returning partial state updates the state graph
    return {
        search_query: query
    };
};
