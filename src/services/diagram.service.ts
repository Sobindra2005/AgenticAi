import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { getLocalLLm, cloudLLM, extractThinkAndContent } from "../utils.js";

export interface DiagramRepairDebug {
  healId: string;
  modelUsed: string;
  durationMs: number;
  originalLength: number;
  repairedLength: number;
  originalError: string;
  timestamp: string;
  reasoningSnippet?: string;
  strategy?: string;
}

export interface DiagramRepairResult {
  fixedCode: string;
  debug: DiagramRepairDebug;
}

/**
 * Fast deterministic sanitizer for common Mermaid syntax errors:
 * - Wraps node labels with parentheses, colons, ampersands, or slashes in double quotes:
 *   e.g. D[Embedding Service (vX.Y)] -> D["Embedding Service (vX.Y)"]
 * - Renames reserved keyword node IDs (end, subgraph, graph)
 * - Strips accidental markdown wrappers and leading 'mermaid' lines
 */
export function sanitizeMermaidSyntax(raw: string): string {
  if (!raw) return "";

  let cleaned = raw
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Strip standalone 'mermaid' on line 1 if model wrote ```\nmermaid\nflowchart ...
  cleaned = cleaned.replace(/^mermaid\s*\r?\n/i, "").trim();

  // Fix unquoted node labels inside [ ... ] containing special characters: ( ) : & / < >
  cleaned = cleaned.replace(/([a-zA-Z0-9_-]+)\[([^"\]\r\n]+)\]/g, (match, id, label) => {
    const trimmed = label.trim();
    if (/[():&/<>]/.test(trimmed) && !(trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      const safe = trimmed.replace(/"/g, "'");
      return `${id}["${safe}"]`;
    }
    return match;
  });

  // Fix unquoted node labels inside ( ... ) containing colons or slashes
  cleaned = cleaned.replace(/([a-zA-Z0-9_-]+)\(([^"\)\r\n]+)\)/g, (match, id, label) => {
    const trimmed = label.trim();
    if (/[:&/<>]/.test(trimmed) && !(trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      const safe = trimmed.replace(/"/g, "'");
      return `${id}("${safe}")`;
    }
    return match;
  });

  // Fix reserved words used as raw node IDs
  cleaned = cleaned.replace(/\b(end|subgraph|graph)\s*\[/gi, "node_$1[");
  cleaned = cleaned.replace(/\b(end|subgraph|graph)\s*\(/gi, "node_$1(");

  return cleaned.trim();
}

/**
 * Checks if a Mermaid snippet still contains obvious unquoted syntax violations
 */
function hasUnquotedSpecialChars(code: string): boolean {
  // Looks for ID[...(...)...] where label is not quoted with "..."
  const hasUnquotedParen = /([a-zA-Z0-9_-]+)\[([^"\]\r\n]*[():&][^"\]\r\n]*)\]/.test(code);
  return hasUnquotedParen;
}

export const DiagramService = {
  /**
   * Repairs broken Mermaid diagram code using:
   * 1. Deterministic heuristic sanitizer (instant 0ms)
   * 2. Local Ollama LLM (deepseek-r1:1.5b) with fast 8s timeout
   * 3. Robust Cloud LLM (Groq) fallback for guaranteed syntax compliance
   */
  async repairMermaidSyntax(
    brokenCode: string,
    errorMessage: string,
    healId = Math.random().toString(36).substring(2, 8)
  ): Promise<DiagramRepairResult> {
    const startTime = Date.now();
    const rawClean = brokenCode
      .replace(/^```(?:mermaid)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    console.log(`\n============================================================`);
    console.log(`[Self-Heal #${healId}] 🔧 Initiating Mermaid Syntax Repair`);
    console.log(`[Self-Heal #${healId}] Parser Error:\n  "${errorMessage || "Unknown parser error"}"`);
    console.log(`[Self-Heal #${healId}] Broken Code Sample (${rawClean.length} chars):\n${rawClean.slice(0, 160)}...`);

    // Step 1: Pre-sanitize with deterministic regex rules
    const heuristicSanitized = sanitizeMermaidSyntax(rawClean);

    const systemPrompt = new SystemMessage(`
You are an expert Mermaid diagram syntax repair specialist.
Your sole job is to fix syntax errors in Mermaid diagram definitions so that mermaid.parse() succeeds without error.

STRICT REPAIR GUIDELINES:
1. Fix the syntax error while strictly preserving all original nodes, connections, labels, and semantic meaning.
2. ALWAYS wrap any node label with parentheses, brackets, colons, or ampersands in double quotes: e.g. A["User (Client)"] --> B["API Gateway"].
3. Never use reserved Mermaid keywords (such as \`end\`, \`subgraph\`, \`graph\`, \`class\`, \`state\`, \`node\`) as raw node IDs. If present, rename the ID (e.g. \`nodeEnd["End"]\`).
4. Ensure the first line is a valid diagram declaration:
   - flowchart TD or flowchart LR
   - sequenceDiagram
   - classDiagram
   - stateDiagram-v2
   - erDiagram
   - journey
   - gantt
   - pie title "..."
5. Do NOT use HTML formatting (<br>, <b>) or Markdown bolding (**text**) inside node labels.
6. Return ONLY the corrected code inside a \`\`\`mermaid ... \`\`\` code block. Do NOT write any introduction, commentary, or markdown outside the block.
`.trim());

    const userPrompt = new HumanMessage(`
BROKEN MERMAID CODE:
\`\`\`mermaid
${heuristicSanitized}
\`\`\`

PARSER ERROR:
${errorMessage || "Syntax error during mermaid.parse()"}

Provide the repaired, syntactically valid Mermaid diagram:
`.trim());

    let responseText = "";
    let modelUsed = "ollama:deepseek-r1:1.5b";
    let strategy = "local-llm";
    let extractedThinking = "";

    // Step 2: Try fast Local LLM (Ollama)
    let localSucceeded = false;
    try {
      console.log(`[Self-Heal #${healId}] 🚀 Dispatching to Local LLM (Ollama: deepseek-r1:1.5b)...`);
      const localModel = getLocalLLm(0.2);
      const res = await localModel.invoke([systemPrompt, userPrompt], { timeout: 8_000 });
      responseText = res.content.toString();

      const { thinking, content } = extractThinkAndContent(responseText);
      extractedThinking = thinking;

      // Extract code block
      const match = content.match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
      let candidate = match ? match[1].trim() : content.trim();
      candidate = sanitizeMermaidSyntax(candidate);

      // Verify local model didn't return empty, identical, or still-broken code
      if (
        candidate &&
        candidate.length > 20 &&
        candidate !== rawClean &&
        !hasUnquotedSpecialChars(candidate)
      ) {
        localSucceeded = true;
        console.log(`[Self-Heal #${healId}] ✓ Local LLM produced valid candidate in ${Date.now() - startTime}ms`);
      } else {
        console.warn(
          `[Self-Heal #${healId}] ⚠️ Local LLM returned incomplete or defective code. Escalating to Cloud LLM...`
        );
      }
    } catch (localErr) {
      console.warn(
        `[Self-Heal #${healId}] ⚠️ Local LLM failed/timed out (${(localErr as Error).message}). Escalating to Cloud LLM...`
      );
    }

    // Step 3: Cloud LLM fallback if local LLM was insufficient
    if (!localSucceeded) {
      try {
        modelUsed = "groq:openai/gpt-oss-120b";
        strategy = "cloud-llm-fallback";
        console.log(`[Self-Heal #${healId}] ⚡ Dispatching to Cloud LLM (Groq)...`);
        const cloudModel = cloudLLM(0.1);
        const cloudStart = Date.now();
        const res = await cloudModel.invoke([systemPrompt, userPrompt], { timeout: 15_000 });
        responseText = res.content.toString();
        console.log(`[Self-Heal #${healId}] ✓ Cloud LLM completed in ${Date.now() - cloudStart}ms`);
      } catch (cloudErr) {
        console.error(`[Self-Heal #${healId}] ❌ Cloud LLM also failed:`, cloudErr);
        // Fall back to heuristic sanitizer if both LLMs failed
        strategy = "heuristic-sanitizer-fallback";
        modelUsed = "heuristic-engine";
        responseText = "```mermaid\n" + heuristicSanitized + "\n```";
      }
    }

    const { thinking, content } = extractThinkAndContent(responseText);
    if (!extractedThinking && thinking) extractedThinking = thinking;

    // Extract code block
    const match = content.match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
    let repaired = match ? match[1].trim() : content.trim();

    // Final sanitization pass (guarantees no accidental markdown or unquoted special chars)
    repaired = sanitizeMermaidSyntax(repaired);

    const durationMs = Date.now() - startTime;
    console.log(`[Self-Heal #${healId}] 📊 Result: Repaired ${rawClean.length} -> ${repaired.length} chars in ${durationMs}ms via ${modelUsed}`);
    console.log(`[Self-Heal #${healId}] Repaired Preview:\n${repaired.slice(0, 160)}...`);
    console.log(`============================================================\n`);

    return {
      fixedCode: repaired,
      debug: {
        healId,
        modelUsed,
        strategy,
        durationMs,
        originalLength: rawClean.length,
        repairedLength: repaired.length,
        originalError: errorMessage,
        timestamp: new Date().toISOString(),
        reasoningSnippet: extractedThinking ? (extractedThinking.length > 1200 ? extractedThinking.slice(0, 1200) + "..." : extractedThinking) : undefined,
      },
    };
  },
};
