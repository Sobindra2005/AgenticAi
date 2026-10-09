import { Annotation } from "@langchain/langgraph";

export interface SourceItem {
  id: string;
  title: string;
  url: string;
  content: string;
  score?: number;
  iteration: number;
  isNew?: boolean;
}

export interface KnowledgeBaseEntry {
  id: string;
  title: string;
  sourceUrl: string;
  domain: string;
  category: "Course" | "Documentation" | "Article" | "Tutorial" | "Resource";
  summary: string;
  keyTopics: string[];
}

export interface EvaluationResult {
  sufficient: boolean;
  reason: string;
  nextQuery?: string;
}

export const ResearchAnnotation = Annotation.Root({
  // Initial user task or topic to research
  task: Annotation<string>,

  // Current iteration count (1-based)
  iteration: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),

  // Max iterations before auto-terminating search loop
  maxIterations: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 3,
  }),

  // Current active search query
  currentQuery: Annotation<string>,

  // History of all executed queries
  queriesHistory: Annotation<string[]>({
    reducer: (prev, next) => Array.from(new Set([...prev, ...next])),
    default: () => [],
  }),

  // Deduplicated accumulated list of sources
  sources: Annotation<SourceItem[]>({
    reducer: (prev, next) => {
      const map = new Map<string, SourceItem>();
      // Keep existing sources
      for (const s of prev) {
        map.set(s.url, { ...s, isNew: false });
      }
      // Add or update with new sources
      for (const s of next) {
        if (!map.has(s.url)) {
          map.set(s.url, { ...s, isNew: true });
        }
      }
      return Array.from(map.values());
    },
    default: () => [],
  }),

  // Sources newly discovered in the current step
  newSourcesThisStep: Annotation<SourceItem[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),

  // Sufficiency evaluation decision & reasoning
  evaluation: Annotation<EvaluationResult>({
    reducer: (_, next) => next,
    default: () => ({
      sufficient: false,
      reason: "",
    }),
  }),

  // Structured Knowledge Base items extracted from research
  knowledgeBase: Annotation<KnowledgeBaseEntry[]>({
    reducer: (prev, next) => {
      const map = new Map<string, KnowledgeBaseEntry>();
      for (const item of [...prev, ...next]) {
        map.set(item.sourceUrl, item);
      }
      return Array.from(map.values());
    },
    default: () => [],
  }),

  // Chain-of-thought / thinking process captured
  thinkContent: Annotation<string>({
    reducer: (prev, next) => next ? (prev ? prev + "\n" + next : next) : prev,
    default: () => "",
  }),

  // Final synthesized markdown response
  finalReport: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),
});

export type ResearchState = typeof ResearchAnnotation.State;