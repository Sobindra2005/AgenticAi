import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { getLocalLLm, getTavily, extractThinkAndContent } from "../utils.js";
import { ResearchState, SourceItem, KnowledgeBaseEntry } from "./state.js";

function extractDomain(urlStr: string): string {
    try {
        const u = new URL(urlStr);
        return u.hostname.replace(/^www\./, "");
    } catch {
        return "web";
    }
}

function categorizeSource(title: string, content: string): KnowledgeBaseEntry["category"] {
    const text = (title + " " + content).toLowerCase();
    if (text.includes("course") || text.includes("specialization") || text.includes("curriculum") || text.includes("syllabus") || text.includes("certification")) {
        return "Course";
    }
    if (text.includes("docs") || text.includes("documentation") || text.includes("api reference") || text.includes("manual")) {
        return "Documentation";
    }
    if (text.includes("tutorial") || text.includes("guide") || text.includes("how to") || text.includes("step-by-step")) {
        return "Tutorial";
    }
    if (text.includes("github.com") || text.includes("repository") || text.includes("framework")) {
        return "Resource";
    }
    return "Article";
}

function extractKeyTopics(title: string, content: string): string[] {
    const combined = `${title} ${content}`.toLowerCase();
    const commonTopics = [
        "langgraph", "langchain", "agentic ai", "multi-agent", "rag", "vector database",
        "deep learning", "machine learning", "nlp", "llm", "transformers", "pytorch",
        "python", "prompt engineering", "fine-tuning", "autonomous agents", "evaluations",
        "state graph", "human-in-the-loop", "memory", "tools", "fastapi", "typescript"
    ];
    const found = commonTopics.filter(topic => combined.includes(topic));
    if (found.length === 0) {
        // Fallback: simple words from title
        return title.split(/\s+/).filter(w => w.length > 4).slice(0, 4);
    }
    return found.slice(0, 5);
}

/**
 * 1. Planning Node:
 * Formulates the initial search query based on user task.
 */
export const planQueryNode = async (state: ResearchState, config?: RunnableConfig): Promise<Partial<ResearchState>> => {
    console.log("--- [NODE: planQueryNode] Starting Planning ---");

    const llm = getLocalLLm(0.5);

    const systemPrompt = new SystemMessage(`
You are an expert AI search query planner.
Your goal is to formulate a single, concise, keyword-rich search query for Tavily to find the best courses, tutorials, and documentation for the user's inquiry.
CRITICAL FORMAT:
Output strictly:
QUERY: <concise 3-7 word search query>

Example:
QUERY: best deep learning specialization courses 2025
    `.trim());

    const userPrompt = new HumanMessage(`User Research Task: "${state.task}"`);

    const response = await llm.invoke([systemPrompt, userPrompt], config);
    const rawText = response.content.toString();
    const { thinking, content } = extractThinkAndContent(rawText);

    // Try explicit QUERY: tag first
    const queryMatch = content.match(/QUERY:\s*([^\n\r]+)/i);
    let query = "";
    if (queryMatch) {
        query = queryMatch[1].trim();
    } else {
        // Fallback: take first non-empty line
        const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
        query = lines[0] || state.task;
    }
    
    // Clean surrounding quotes and prefixes
    query = query.replace(/^["']|["']$/g, "").replace(/^QUERY:\s*/i, "").trim();

    // Guardrail: if the query is overly long (e.g. conversational paragraph), trim or fallback
    if (query.length > 120 || query.includes("However") || query.includes("If you're")) {
        query = state.task.slice(0, 100);
    }

    console.log(`[planQueryNode] Planned Query: "${query}"`);

    return {
        currentQuery: query,
        queriesHistory: [query],
        iteration: 1,
        thinkContent: thinking ? `[Planning Round 1]\n${thinking}` : ""
    };
};

/**
 * 2. Search & KB Ingestion Node:
 * Executes Tavily search, deduplicates sources, extracts new Knowledge Base items.
 */
export const searchTavilyNode = async (state: ResearchState): Promise<Partial<ResearchState>> => {
    const query = state.currentQuery || state.task;
    const iteration = state.iteration || 1;

    console.log(`--- [NODE: searchTavilyNode] Searching iteration ${iteration} for: "${query}" ---`);

    const tavily = getTavily();
    let rawResults: any[] = [];

    try {
        const response = await tavily.invoke({ query });
        if (response && typeof response === "object" && "results" in response && Array.isArray((response as any).results)) {
            rawResults = (response as any).results;
        }
    } catch (error) {
        console.error("[searchTavilyNode] Tavily search error:", error);
    }

    const existingUrls = new Set((state.sources || []).map(s => s.url));
    const newSources: SourceItem[] = [];

    for (const r of rawResults) {
        const url = r.url;
        if (!url) continue;

        const isNew = !existingUrls.has(url);
        const item: SourceItem = {
            id: r.id || Math.random().toString(36).substring(2, 9),
            title: r.title || "Untitled Source",
            url,
            content: r.content || "",
            score: r.score,
            iteration,
            isNew,
        };

        newSources.push(item);
    }

    console.log(`[searchTavilyNode] Retrieved ${rawResults.length} results (${newSources.filter(s => s.isNew).length} new sources)`);

    return {
        sources: newSources,
        newSourcesThisStep: newSources.filter(s => s.isNew),
    };
};

/**
 * 3. Evaluation / Sufficiency Node:
 * Analyzes gathered sources and decides whether another research loop is needed.
 */
export const evaluateSufficiencyNode = async (state: ResearchState, config?: RunnableConfig): Promise<Partial<ResearchState>> => {
    const iteration = state.iteration || 1;
    const maxIterations = state.maxIterations || 3;
    const sources = state.sources || [];

    console.log(`--- [NODE: evaluateSufficiencyNode] Evaluating Iteration ${iteration}/${maxIterations} (${sources.length} total sources) ---`);

    // Safety guardrail: stop if max iterations reached
    if (iteration >= maxIterations) {
        console.log("[evaluateSufficiencyNode] Max iterations reached. Concluding research.");
        return {
            evaluation: {
                sufficient: true,
                reason: `Reached maximum research rounds (${maxIterations}). Comprehensive knowledge collected.`,
            }
        };
    }

    // Safety guardrail: if we have 8+ sources, we already have plenty of information
    if (sources.length >= 8) {
        console.log("[evaluateSufficiencyNode] Abundant sources collected (8+). Concluding research.");
        return {
            evaluation: {
                sufficient: true,
                reason: `Collected ${sources.length} sources covering the topic thoroughly.`,
            }
        };
    }

    const llm = getLocalLLm(0.4);

    const sourcesSummary = sources.slice(0, 6).map((s, idx) => 
        `[${idx + 1}] "${s.title}" (${s.url})\nSummary: ${s.content.slice(0, 160)}...`
    ).join("\n\n");

    const systemPrompt = new SystemMessage(`
You are an expert AI research evaluator.
Your job is to decide if the currently collected sources are SUFFICIENT to fully answer the user's research request, or if another targeted web search is needed to gather missing details (such as detailed course curriculum, hands-on tutorials, prerequisites, or alternative platforms).

You MUST respond strictly using this format:
DECISION: SUFFICIENT or INSUFFICIENT
REASON: <1 to 2 concise sentences explaining why>
NEXT_QUERY: <If INSUFFICIENT, provide a single refined search query. If SUFFICIENT, write NONE>
    `.trim());

    const userPrompt = new HumanMessage(`
User Request: "${state.task}"
Queries already searched: ${state.queriesHistory.map(q => `"${q}"`).join(", ")}

Sources collected so far (${sources.length}):
${sourcesSummary}
    `.trim());

    const response = await llm.invoke([systemPrompt, userPrompt], config);
    const rawText = response.content.toString();
    const { thinking, content } = extractThinkAndContent(rawText);

    // Parse the output
    const isSufficientMatch = content.match(/DECISION:\s*(SUFFICIENT|INSUFFICIENT)/i);
    const reasonMatch = content.match(/REASON:\s*([^\n\r]+)/i);
    const nextQueryMatch = content.match(/NEXT_QUERY:\s*([^\n\r]+)/i);

    let isSufficient = isSufficientMatch ? isSufficientMatch[1].toUpperCase() === "SUFFICIENT" : (sources.length >= 4);
    let reason = reasonMatch ? reasonMatch[1].trim() : (isSufficient ? "Sufficient comprehensive details gathered." : "Need deeper course syllabus and project details.");
    let nextQuery = nextQueryMatch ? nextQueryMatch[1].trim() : "";

    // If query was None or quotes, clean it
    if (nextQuery.toUpperCase() === "NONE" || nextQuery.length < 3) {
        nextQuery = "";
    }
    nextQuery = nextQuery.replace(/^["']|["']$/g, "").trim();

    if (!isSufficient && !nextQuery) {
        // Fallback next query if model didn't specify one
        nextQuery = `${state.task} syllabus curriculum projects`;
    }

    console.log(`[evaluateSufficiencyNode] Decision: ${isSufficient ? "SUFFICIENT" : "INSUFFICIENT"}. Reason: "${reason}"`);
    if (!isSufficient) {
        console.log(`[evaluateSufficiencyNode] Next Query for Iteration ${iteration + 1}: "${nextQuery}"`);
    }

    if (isSufficient) {
        return {
            evaluation: {
                sufficient: true,
                reason,
            },
            thinkContent: thinking ? `[Evaluation Round ${iteration}]\n${thinking}` : "",
        };
    } else {
        return {
            iteration: iteration + 1,
            currentQuery: nextQuery,
            queriesHistory: [nextQuery],
            evaluation: {
                sufficient: false,
                reason,
                nextQuery,
            },
            thinkContent: thinking ? `[Evaluation Round ${iteration}]\n${thinking}` : "",
        };
    }
};

/**
 * 4. Synthesizer Node:
 * Produces the final comprehensive research report citing all gathered sources.
 */
export const synthesizeReportNode = async (state: ResearchState, config?: RunnableConfig): Promise<Partial<ResearchState>> => {
    console.log("--- [NODE: synthesizeReportNode] Generating Final Report ---");

    const llm = getLocalLLm(0.6);
    const sources = state.sources || [];

    const sourcesReferenceList = sources.map((s, idx) => 
        `[${idx + 1}] Title: ${s.title}\nURL: ${s.url}\nExcerpt: ${s.content.slice(0, 300)}`
    ).join("\n\n");

    const systemPrompt = new SystemMessage(`
You are a principal AI research analyst and educator.
Your task is to synthesize all research findings into a comprehensive, beautifully structured guide answering the user's prompt.

GUIDELINES:
1. Provide a clear, insightful executive summary.
2. If looking for courses or learning materials, structure each recommendation clearly:
   - Course/Resource Name & Platform
   - Key Syllabus & What You'll Learn
   - Prerequisites & Difficulty Level
   - Hands-on Projects & Practical Takeaways
3. ALWAYS cite your claims using bracketed numbers like [1], [2] matching the source numbers provided.
4. Conclude with an actionable learning roadmap / next steps.
5. Format with rich Markdown: headers (##, ###), bullet points, and tables where applicable.
    `.trim());

    const userPrompt = new HumanMessage(`
User Request: "${state.task}"

Verified Research Sources:
${sourcesReferenceList}

Synthesize a complete, definitive answer with numbered citations:
    `.trim());

    const response = await llm.invoke([systemPrompt, userPrompt], config);
    const rawText = response.content.toString();
    const { thinking, content } = extractThinkAndContent(rawText);

    console.log("[synthesizeReportNode] Report synthesis complete.");

    return {
        finalReport: content,
        thinkContent: thinking ? `[Synthesis]\n${thinking}` : "",
    };
};
