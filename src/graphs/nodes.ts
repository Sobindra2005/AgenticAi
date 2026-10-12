import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";
import { getLocalLLm, getTavily, extractThinkAndContent, withLLMStructuredOutput } from "../utils.js";
import { ResearchState, SourceItem, KnowledgeBaseEntry, RoutingDecision } from "./state.js";
import { searchRelevantChunks, syncKnowledgeBaseVectors } from "../services/rag.service.js";

export const routingDecisionSchema = z.object({
    route: z.enum([
        "DIRECT_CONVERSATION",
        "ANSWER_FROM_KB",
        "SEARCH_KNOWLEDGE_GAP",
        "NEW_TOPIC_RESEARCH"
    ]).describe("The cognitive routing decision based on conversation and knowledge coverage"),
    searchQuery: z.string().nullable().optional().describe("Standalone rewritten search query (3-8 words) if web search is needed, or null if no search needed"),
    reason: z.string().describe("1-2 sentence explanation of your decision")
});

export type RoutingDecisionOutput = z.infer<typeof routingDecisionSchema>;

export const sufficiencyEvaluationSchema = z.object({
    isSufficient: z.boolean().describe("Whether the collected sources are sufficient to fully answer the user query"),
    reason: z.string().describe("1-2 concise sentences explaining why sources are sufficient or what specific information is missing"),
    nextQuery: z.string().nullable().optional().describe("If isSufficient is false, provide a single refined search query (3-7 words) for the missing detail. If isSufficient is true, null")
});

export type SufficiencyEvaluationOutput = z.infer<typeof sufficiencyEvaluationSchema>;

export const conversationSummarySchema = z.object({
    summary: z.string().describe("Concise 2-sentence summary of the main topics, queries, and conclusions explored so far in this conversation")
});

export type ConversationSummaryOutput = z.infer<typeof conversationSummarySchema>;

/**
 * 0. Knowledge Base Retrieval Node (RAG via PostgreSQL pgvector & nomic-embed-text):
 * Semantically searches ONLY the thread's curated Knowledge Base for relevant knowledge chunks.
 * Raw search sources are not indexed until curated into the Knowledge Base.
 */
export const retrieveFromKBNode = async (
    state: ResearchState,
    config?: RunnableConfig
): Promise<Partial<ResearchState>> => {
    const threadId = config?.configurable?.thread_id as string | undefined;
    console.log(`\n--- [NODE: retrieveFromKBNode] Querying pgvector Knowledge Base for thread: "${threadId || 'adhoc'}" ---`);

    if (!threadId) {
        console.log("[retrieveFromKBNode] No threadId provided in config, skipping Knowledge Base search.");
        return { relevantChunks: [] };
    }

    try {
        // Synchronize ONLY sources that are currently present in state.knowledgeBase
        const kbEntries = state.knowledgeBase || [];
        if (kbEntries.length > 0 && state.sources && state.sources.length > 0) {
            const kbUrls = new Set(kbEntries.map(k => k.sourceUrl));
            const kbSources = state.sources.filter(s => kbUrls.has(s.url) && s.content);
            if (kbSources.length > 0) {
                await syncKnowledgeBaseVectors(threadId, kbSources, kbUrls);
            }
        }

        // Perform semantic similarity search across Knowledge Base chunks
        const relevantChunks = await searchRelevantChunks(threadId, state.task, 4);

        if (relevantChunks.length > 0) {
            console.log(`[retrieveFromKBNode] ✓ Retrieved ${relevantChunks.length} relevant chunk(s) from Knowledge Base. Top match: "${relevantChunks[0].sourceTitle}" (${(relevantChunks[0].similarity * 100).toFixed(1)}% match)`);
        } else {
            console.log("[retrieveFromKBNode] (No matching chunks in Knowledge Base for this query)");
        }

        return {
            relevantChunks,
            thinkContent: relevantChunks.length > 0
                ? `Retrieved ${relevantChunks.length} relevant excerpt(s) from Knowledge Base:\n` +
                  relevantChunks.map(c => `• "${c.sourceTitle}" (${(c.similarity * 100).toFixed(1)}% match)`).join("\n")
                : ""
        };
    } catch (err) {
        console.warn("[retrieveFromKBNode] Knowledge Base retrieval error:", (err as Error).message);
        return { relevantChunks: [] };
    }
};

/**
 * 1. Cognitive Planning & Intent/Coverage Router Node:
 * Correlates user prompt, recent conversation, and semantically retrieved RAG chunks
 * to decide whether web search is even needed, or if an answer can be delivered
 * directly from memory or previous conversation.
 */
export const planQueryNode = async (state: ResearchState, config?: RunnableConfig): Promise<Partial<ResearchState>> => {
    console.log("\n--- [NODE: planQueryNode] Analyzing Intent & Knowledge Coverage ---");

    const existingSources = state.sources || [];
    const existingKb = state.knowledgeBase || [];
    const relevantChunks = state.relevantChunks || [];
    
    // Semantic RAG retrieved excerpts with cosine similarity scores from Knowledge Base
    const ragKnowledgeSection = relevantChunks.length > 0
        ? relevantChunks.map((chunk, idx) =>
            `[Knowledge Base Match ${idx + 1}] (Cosine Similarity: ${(chunk.similarity * 100).toFixed(1)}%)\nSource: "${chunk.sourceTitle}" (${chunk.sourceUrl})\nRelevant Excerpt:\n"${chunk.content}"`
        ).join("\n\n")
        : "(No matching knowledge chunks found in Knowledge Base)";

    // High-level catalog of Knowledge Base entries in thread memory
    const existingKbCatalog = existingKb.length > 0
        ? existingKb.map((k, idx) => `[KB ${idx + 1}] "${k.title}" (${k.sourceUrl}) - Category: ${k.category}\nSummary: ${k.summary}`).join("\n\n")
        : "(Knowledge Base is currently empty - no curated sources saved yet)";

    // High-level catalog of existing sources in thread memory
    const existingSourcesCatalog = existingSources.length > 0
        ? existingSources.map((s, idx) => `[Source ${idx + 1}] "${s.title}" (${s.url})`).join("\n")
        : "(Session sources buffer is currently empty)";

    // Sliding window of recent conversation messages (last 3 messages)
    const recentMessages = (state.messages || []).slice(-3);
    const summaryPrefix = state.conversationSummary
        ? `Prior Discussion Summary:\n"${state.conversationSummary}"\n\n`
        : "";
    const chatContext = recentMessages.length > 0
        ? recentMessages.map(m => `${m.getType() === "human" ? "User" : "Assistant"}: ${m.content.slice(0, 250)}`).join("\n")
        : "(No prior messages in thread)";
    const fullConversationContext = `${summaryPrefix}Recent Messages:\n${chatContext}`;

    // Active Topic History from previous graph cycles
    const activeTopics = (state.queriesHistory || []).join(" -> ") || "(None yet)";

    const systemPrompt = new SystemMessage(`
You are the Cognitive Intent, Coreference Resolution & Knowledge Coverage Router for an intelligent AI research assistant.
Your job is to analyze the user's latest request in correlation with the active research topic, conversation history, and semantically retrieved knowledge chunks from PostgreSQL pgvector RAG memory.

TASK 1: COREFERENCE RESOLUTION & QUERY REFORMULATION
Natural user prompts often omit the subject or use implicit references (e.g., "how to apply", "give me a stepwise guide", "what are the cloud tools", "tell me more about this", "are there any limits?", "compare with alternatives").
If the user's prompt is a follow-up or drill-down related to the ongoing conversation or active topic:
- You MUST resolve all implicit references and pronouns organically.
- Formulate a completely self-contained, STANDALONE search query that combines the core topic entity with the user's specific request.
- Example: If the active topic is "GitHub Student Developer Pack" and the user asks "how do I sign up and get verified?", the searchQuery MUST be "GitHub Student Developer Pack application verification steps", NOT just "how do I sign up".

TASK 2: INTENT & KNOWLEDGE COVERAGE ROUTING
Determine the single best route:

1. "DIRECT_CONVERSATION":
   - The user is greeting, giving feedback ("thanks", "great"), asking to format/translate/reorganize previous output ("put in a table", "summarize in 3 bullets"), or asking purely conversational questions that require no web search.
   - searchQuery: null

2. "ANSWER_FROM_KB":
   - The user is asking a factual question whose answer is ALREADY CLEARLY COVERED in the "Semantically Retrieved Knowledge via pgvector RAG (from Knowledge Base)" or recent conversation history.
   - searchQuery: null

3. "SEARCH_KNOWLEDGE_GAP":
   - The user is asking a follow-up, drill-down, or comparison related to the active topic, but the required information is MISSING from the Knowledge Base.
   - searchQuery: Standalone rewritten search query (3-8 words) combining the topic with the missing aspect.

4. "NEW_TOPIC_RESEARCH":
   - The user has switched to a brand new, unrelated research subject with zero connection to the prior conversation.
   - searchQuery: Standalone search query (3-8 words) for the new topic.

FEW-SHOT EXAMPLES:
- Context: Active topic is "GitHub Student Developer Pack". Retrieved chunks discuss Namecheap domain and DigitalOcean credit.
  User: "Which domain registrar did you find in it?"
  -> { "route": "ANSWER_FROM_KB", "searchQuery": null, "reason": "Retrieved knowledge chunks specifically cover Namecheap domain registration." }

- Context: Active topic is "GitHub Student Developer Pack". Retrieved chunks only cover benefits, not verification documents.
  User: "how do i sign up and what documents do i need"
  -> { "route": "SEARCH_KNOWLEDGE_GAP", "searchQuery": "GitHub Student Developer Pack student verification application steps documents", "reason": "Follow-up question on registration requirements not covered in existing sources." }

- User: "Research GitHub Student Developer Pack"
  -> { "route": "NEW_TOPIC_RESEARCH", "searchQuery": "GitHub Student Developer Pack benefits tools", "reason": "User started a new topic research." }

- Context: Previous response was a long report.
  User: "can you present that as a markdown comparison table?"
  -> { "route": "DIRECT_CONVERSATION", "searchQuery": null, "reason": "Formatting request on prior content, no search needed." }
`.trim());

    const userPrompt = new HumanMessage(`
User Prompt: "${state.task}"

Active Research Topics / Prior Queries:
${activeTopics}

Recent Conversation Context:
${fullConversationContext}

Semantically Retrieved Knowledge via pgvector RAG (from Knowledge Base):
${ragKnowledgeSection}

Curated Knowledge Base Catalog (${existingKb.length} items):
${existingKbCatalog}

All Available Research Sources (${existingSources.length} sources):
${existingSourcesCatalog}
`.trim());

    const structuredRouter = withLLMStructuredOutput(routingDecisionSchema, 0.2);

    let route: RoutingDecision = "NEW_TOPIC_RESEARCH";
    let query: string = state.task;
    let reason = "Default to fresh research";

    try {
        const decision = await structuredRouter.invoke([systemPrompt, userPrompt], { ...config, timeout: 30_000 });
        if (decision.route) route = decision.route;
        if (decision.reason) reason = decision.reason;
        if (decision.searchQuery) query = decision.searchQuery.trim();
    } catch (err) {
        console.warn("[planQueryNode] Structured output routing failed, falling back to research:", (err as Error).message);
        route = existingSources.length > 0 ? "SEARCH_KNOWLEDGE_GAP" : "NEW_TOPIC_RESEARCH";
        query = state.task;
        reason = "Fallback router";
    }

    // Clean surrounding quotes and prefixes from LLM generated query
    query = query.replace(/^["']|["']$/g, "").replace(/^QUERY:\s*/i, "").trim();
    if (query.length > 120) query = query.slice(0, 100);

    console.log(`[planQueryNode] Route Decided: ${route}`);
    console.log(`[planQueryNode] Reason: "${reason}"`);
    if (route === "SEARCH_KNOWLEDGE_GAP" || route === "NEW_TOPIC_RESEARCH") {
        console.log(`[planQueryNode] Search Query: "${query}"`);
    } else {
        console.log(`[planQueryNode] No search needed. Answering directly!`);
    }

    // When starting a brand-new topic, clear active sources buffer so old sources don't pollute
    const resetSources = route === "NEW_TOPIC_RESEARCH" ? [] : undefined;

    return {
        route,
        routingReason: reason,
        currentQuery: (route === "DIRECT_CONVERSATION" || route === "ANSWER_FROM_KB") ? "" : query,
        ...(query && route !== "DIRECT_CONVERSATION" && route !== "ANSWER_FROM_KB"
            ? { queriesHistory: [query] }
            : {}),
        ...(resetSources !== undefined ? { sources: resetSources } : {}),
        iteration: 1,
        evaluation: { sufficient: false, reason: "" },
        thinkContent: `[Cognitive Router: ${route}]\n${reason}`
    };
};

/**
 * 2. Search & KB Ingestion Node:
 * Executes Tavily search, deduplicates sources, extracts new Knowledge Base items.
 */
export const searchTavilyNode = async (state: ResearchState, config?: RunnableConfig): Promise<Partial<ResearchState>> => {
    const query = state.currentQuery || state.task;
    const iteration = state.iteration || 1;

    const existingCount = state.sources?.length ?? 0;
    console.log(`--- [NODE: searchTavilyNode] Searching iteration ${iteration} for: "${query}" (Already has ${existingCount} sources in state) ---`);

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
        // Retain complete parsed page content from Tavily for deep contextual indexing
        const fullContent = (r.raw_content || r.rawContent || r.content || "").trim();
        const item: SourceItem = {
            id: r.id || Math.random().toString(36).substring(2, 9),
            title: r.title || "Untitled Source",
            url,
            content: fullContent,
            score: r.score,
            iteration,
            isNew,
        };

        newSources.push(item);
    }

    const actualNewSources = newSources.filter(s => s.isNew);
    console.log(`[searchTavilyNode] Retrieved ${rawResults.length} results (${actualNewSources.length} new sources)`);

    return {
        sources: newSources,
        newSourcesThisStep: actualNewSources,
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

    const structuredEvaluator = withLLMStructuredOutput(sufficiencyEvaluationSchema, 0.2);

    const sourcesSummary = sources.slice(0, 6).map((s, idx) =>
        `[${idx + 1}] "${s.title}" (${s.url})\nSummary: ${s.content.slice(0, 160)}...`
    ).join("\n\n");

    const systemPrompt = new SystemMessage(`
You are an expert AI research evaluator.
Your job is to decide if the currently collected sources are SUFFICIENT to fully answer the user's research request, or if another targeted web search is needed to gather missing details (such as detailed steps, syllabus, technical limits, or alternatives).

Evaluate objectively:
- If key aspects are already well covered in the collected sources, set isSufficient to true, with nextQuery as null.
- If essential details are missing, set isSufficient to false and provide a refined standalone nextQuery (3-7 words).
    `.trim());

    const userPrompt = new HumanMessage(`
User Request: "${state.task}"
Queries already searched: ${state.queriesHistory.map(q => `"${q}"`).join
(", ")}

Sources collected so far (${sources.length}):
${sourcesSummary}
    `.trim());

    let isSufficient = sources.length >= 4;
    let reason = isSufficient ? "Sufficient comprehensive details gathered." : "Need deeper details.";
    let nextQuery = "";

    try {
        const evalResult = await structuredEvaluator.invoke([systemPrompt, userPrompt], { ...config, timeout: 30_000 });
        isSufficient = evalResult.isSufficient;
        reason = evalResult.reason;
        if (!isSufficient && evalResult.nextQuery) {
            nextQuery = evalResult.nextQuery.replace(/^["']|["']$/g, "").trim();
        }
    } catch (err) {
        console.warn("[evaluateSufficiencyNode] Structured evaluation failed, using heuristic fallback:", (err as Error).message);
    }

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
            thinkContent: `[Evaluation Round ${iteration}: SUFFICIENT]\n${reason}`,
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
            thinkContent: `[Evaluation Round ${iteration}: INSUFFICIENT]\nReason: ${reason}\nNext Query: ${nextQuery}`,
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
    const relevantChunks = state.relevantChunks || [];
    const route = state.route || "NEW_TOPIC_RESEARCH";
    console.log(`[synthesizeReportNode Debug] Synthesis mode for route: "${route}" (with ${sources.length} sources, ${relevantChunks.length} RAG chunks)`);

    const sourcesReferenceList = sources.map((s, idx) =>
        `[${idx + 1}] Title: ${s.title}\nURL: ${s.url}\nExcerpt: ${s.content.slice(0, 300)}`
    ).join("\n\n");

    const ragEvidenceList = relevantChunks.map((chunk) => {
        const sourceIndex = sources.findIndex(s => s.url === chunk.sourceUrl);
        const citeNum = sourceIndex >= 0 ? `[${sourceIndex + 1}]` : `[Source Reference]`;
        return `${citeNum} "${chunk.sourceTitle}" (Cosine Match: ${(chunk.similarity * 100).toFixed(1)}%)\nRelevant Evidence: "${chunk.content}"`;
    }).join("\n\n");

    const summaryPrefix = state.conversationSummary
        ? `Long-term Thread Summary:\n"${state.conversationSummary}"\n\n`
        : "";
    const recentMessages = (state.messages || []).slice(-2);
    const conversationContext = recentMessages.length > 0
        ? summaryPrefix + recentMessages.map(m => `${m.getType() === "human" ? "User" : "Assistant"}: ${m.content.slice(0, 400)}`).join("\n\n")
        : summaryPrefix;

    let systemPrompt: SystemMessage;
    let userPrompt: HumanMessage;

    if (route === "DIRECT_CONVERSATION") {
        systemPrompt = new SystemMessage(`
You are a helpful and intelligent AI research assistant.
Answer the user's current request directly using the recent conversation context.
Format cleanly with Markdown (using tables, bullet points, or code blocks where requested).
        `.trim());

        userPrompt = new HumanMessage(`
Recent Conversation Context:
${conversationContext || "(No prior conversation)"}

User Request: "${state.task}"
        `.trim());
    } else {
        systemPrompt = new SystemMessage(`
You are a principal AI research analyst.
Your task is to synthesize verified research findings into a comprehensive, beautifully structured report responding directly to the user's prompt.

GUIDELINES:
1. Provide a clear, insightful executive summary answering the user's query directly.
2. Structure the core points with logical sections, bullet points, and tables where applicable.
3. CITATIONS: ALWAYS cite claims using bracketed numbers matching the numbered sources below (e.g. [1], [2], [3]). Place the citation immediately after the factual statement, tool, or claim (e.g. "GitHub provides free Copilot access [1]"). When multiple sources support a point, cite them like [1, 2] or [1][2]. Every single factual tool, service, benefit, or claim MUST be backed by a source number.
4. Conclude with actionable takeaways, next steps, or a roadmap relevant to the user's query.
5. Format with rich Markdown: headers (##, ###), bullet points, and tables where applicable.
6. Strictly stick to verified information. Do not invent unverified sources or source numbers outside the list.
        `.trim());

        userPrompt = new HumanMessage(`
${conversationContext ? "Previous Conversation Context:\n" + conversationContext + "\n\n" : ""}User Request: "${state.task}"

${ragEvidenceList ? `Top Semantically Retrieved Evidence (pgvector RAG):\n${ragEvidenceList}\n\n` : ""}Verified Research Sources:
${sourcesReferenceList || "(Answer based on knowledge base in memory)"}

Synthesize a complete, definitive answer with numbered citations:
        `.trim());
    }

    const response = await llm.invoke([systemPrompt, userPrompt], { ...config, timeout: 30_000 });
    const rawText = response.content.toString();
    const { thinking, content } = extractThinkAndContent(rawText);

    console.log("[synthesizeReportNode] Report synthesis complete.");

    // Append assistant response to messages for continuous conversational memory
    const newAIMsg = new AIMessage(content);

    // Update rolling conversationSummary when thread has 3 or more messages
    let updatedSummary = state.conversationSummary || "";
    const totalMsgCount = (state.messages?.length || 0) + 1;
    if (totalMsgCount >= 3) {
        try {
            const summaryLlm = withLLMStructuredOutput(conversationSummarySchema, 0.2);
            const historySample = [...(state.messages || []).slice(-4), newAIMsg]
                .map(m => `${m.getType() === "human" ? "User" : "Assistant"}: ${m.content.slice(0, 200)}`)
                .join("\n");

            const sumPrompt = new SystemMessage(
                "You are a conversation summarizer. Write a concise 2-sentence summary of the main topics, queries, and conclusions explored so far in this conversation. Do not invent details."
            );
            const sumRes = await summaryLlm.invoke([sumPrompt, new HumanMessage(historySample)], { timeout: 15_000 });
            if (sumRes.summary && sumRes.summary.trim().length > 10) {
                updatedSummary = sumRes.summary.trim();
                console.log(`[synthesizeReportNode] Updated Thread Conversation Summary: "${updatedSummary}"`);
            }
        } catch (sumErr) {
            console.warn("[synthesizeReportNode] Rolling summary update skipped:", (sumErr as Error).message);
        }
    }

    return {
        finalReport: content,
        messages: [newAIMsg],
        conversationSummary: updatedSummary,
        thinkContent: thinking ? `[Synthesis]\n${thinking}` : "",
    };
};
