import React, { useState, useEffect, useRef } from "react";
import { AppHeader } from "./components/AppHeader.js";
import { ThreadsHubView, ThreadItem } from "./components/ThreadsHubView.js";
import { WorkspaceView, MessageItem } from "./components/WorkspaceView.js";
import { TraceStep } from "./components/VaultDrawer.js";
import { SourceItem, KnowledgeBaseEntry } from "../graphs/state.js";

function extractDomain(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

function categorizeSource(
  title: string,
  content: string
): KnowledgeBaseEntry["category"] {
  const text = ((title || "") + " " + (content || "")).toLowerCase();
  if (
    text.includes("course") ||
    text.includes("specialization") ||
    text.includes("curriculum") ||
    text.includes("syllabus") ||
    text.includes("certification")
  ) {
    return "Course";
  }
  if (
    text.includes("docs") ||
    text.includes("documentation") ||
    text.includes("api reference") ||
    text.includes("manual")
  ) {
    return "Documentation";
  }
  if (
    text.includes("tutorial") ||
    text.includes("guide") ||
    text.includes("how to") ||
    text.includes("step-by-step")
  ) {
    return "Tutorial";
  }
  if (
    text.includes("github.com") ||
    text.includes("repository") ||
    text.includes("framework")
  ) {
    return "Resource";
  }
  return "Article";
}

function extractKeyTopics(title: string, content: string): string[] {
  const combined = ((title || "") + " " + (content || "")).toLowerCase();
  const commonTopics = [
    "langgraph",
    "langchain",
    "agentic ai",
    "multi-agent",
    "rag",
    "vector database",
    "deep learning",
    "machine learning",
    "nlp",
    "llm",
    "transformers",
    "pytorch",
    "python",
    "prompt engineering",
    "fine-tuning",
    "autonomous agents",
    "evaluations",
    "state graph",
    "human-in-the-loop",
    "memory",
    "tools",
    "fastapi",
    "typescript",
  ];
  const found = commonTopics.filter((topic) => combined.includes(topic));
  if (found.length === 0) {
    return (title || "")
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 4);
  }
  return found.slice(0, 5);
}

export interface AppProps {
  title?: string;
  initialThreads?: ThreadItem[];
  initialActiveThreadId?: string | null;
  error?: string | null;
}

export const App: React.FC<AppProps> = ({
  initialThreads = [],
  initialActiveThreadId = null,
}) => {
  const [threads, setThreads] = useState<ThreadItem[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(
    initialActiveThreadId
  );
  const [activeView, setActiveView] = useState<"threads" | "workspace">(
    initialActiveThreadId ? "workspace" : "threads"
  );
  const [activeThreadTitle, setActiveThreadTitle] = useState(
    "New Research Thread"
  );

  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [kb, setKb] = useState<KnowledgeBaseEntry[]>([]);
  const [traces, setTraces] = useState<TraceStep[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeEventSourceRef = useRef<EventSource | null>(null);

  // Helper to log telemetry trace
  const logTrace = (node: string, desc: string, timeStr?: string) => {
    const newStep: TraceStep = {
      id: Date.now() + Math.random(),
      node,
      desc,
      time: timeStr || new Date().toLocaleTimeString(),
    };
    setTraces((prev) => [newStep, ...prev]);
  };

  // Helper to fetch all threads from DB
  const fetchThreads = async () => {
    try {
      const res = await fetch("/api/threads");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.threads)) {
          setThreads(data.threads);
          return data.threads;
        }
      }
    } catch (e) {
      console.warn("Failed to fetch threads:", e);
    }
    return [];
  };

  // Load a single thread's complete data from DB
  const loadThread = async (id: string) => {
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(id)}`);
      if (res.ok) {
        const data = await res.json();
        setActiveThreadId(id);
        if (typeof window !== "undefined") {
          localStorage.setItem("agentic_active_thread_id", id);
        }

        const title = data.thread?.title || "Research Thread";
        setActiveThreadTitle(title);

        // Format loaded messages
        const msgs: MessageItem[] = (data.messages || []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          thinking: m.thinking,
          report: m.report || m.content,
          iterations: m.iterations || 1,
        }));
        setMessages(msgs);
        setSources(data.sources || []);
        setKb(data.kb || []);
        setTraces(data.traces || []);
        setActiveView("workspace");
      }
    } catch (e) {
      console.error(`Failed to load thread ${id}:`, e);
    }
  };

  // Save assets for current thread to DB
  const saveThreadAssets = async (
    threadId: string,
    currentSources: SourceItem[],
    currentKb: KnowledgeBaseEntry[],
    currentTraces: TraceStep[]
  ) => {
    try {
      await fetch(`/api/threads/${encodeURIComponent(threadId)}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources: currentSources,
          kb: currentKb,
          trace: currentTraces,
        }),
      });
    } catch (e) {
      console.error("Failed to save thread assets:", e);
    }
  };

  // Create new thread via DB
  const handleCreateNewThread = async (
    initialTitle = "New Research Thread"
  ) => {
    try {
      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: initialTitle }),
      });
      if (res.ok) {
        const data = await res.json();
        const newThread = data.thread;
        setThreads((prev) => [newThread, ...prev]);
        await loadThread(newThread.id);
        return newThread.id;
      }
    } catch (e) {
      console.error("Failed to create thread:", e);
    }
  };

  // Delete thread via DB
  const handleDeleteThread = async (id: string) => {
    try {
      await fetch(`/api/threads/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (activeThreadId === id) {
        setActiveThreadId(null);
        if (typeof window !== "undefined") {
          localStorage.removeItem("agentic_active_thread_id");
        }
        setActiveView("threads");
      }
    } catch (e) {
      console.error("Failed to delete thread:", e);
    }
  };

  // Clear thread messages and assets
  const handleClearThread = async () => {
    if (!activeThreadId) return;
    try {
      await fetch(`/api/threads/${encodeURIComponent(activeThreadId)}/clear`, {
        method: "POST",
      });
      setMessages([]);
      setSources([]);
      setKb([]);
      setTraces([]);
      fetchThreads();
    } catch (e) {
      console.error("Failed to clear thread:", e);
    }
  };

  // Add selected sources to Knowledge Base
  const handleAddToKb = (selected: SourceItem[]) => {
    if (!activeThreadId || selected.length === 0) return;
    const existingUrls = new Set(kb.map((k) => k.sourceUrl));
    const newEntries: KnowledgeBaseEntry[] = [];

    selected.forEach((source) => {
      if (!existingUrls.has(source.url)) {
        newEntries.push({
          id: "kb-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          title: source.title || "Untitled Source",
          sourceUrl: source.url,
          domain: extractDomain(source.url),
          category: categorizeSource(source.title, source.content || ""),
          summary:
            (source.content || "").slice(0, 240) +
            ((source.content || "").length > 240 ? "..." : ""),
          keyTopics: extractKeyTopics(source.title || "", source.content || ""),
        });
        existingUrls.add(source.url);
      }
    });

    const updatedKb = [...kb, ...newEntries];
    setKb(updatedKb);
    saveThreadAssets(activeThreadId, sources, updatedKb, traces);
    fetchThreads();
  };

  // Clear traces
  const handleClearTraces = () => {
    setTraces([]);
    if (activeThreadId) {
      saveThreadAssets(activeThreadId, sources, kb, []);
    }
  };

  // Submit research query and stream response
  const handleSubmitQuery = async (query: string) => {
    let currentId = activeThreadId;
    if (!currentId) {
      currentId = await handleCreateNewThread(query.slice(0, 48));
      if (!currentId) return;
    }

    setIsSubmitting(true);

    // 1. Add user message
    const userMsg: MessageItem = {
      role: "user",
      content: query,
    };

    // 2. Add assistant placeholder
    const assistantMsgIndex = messages.length + 1;
    const assistantMsg: MessageItem = {
      role: "assistant",
      content: "",
      isStreaming: true,
      statusText: "Starting LangGraph workflow...",
      iterations: 1,
      rounds: [],
      thinking: "",
      report: "",
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    // Close any previous stream
    if (activeEventSourceRef.current) {
      activeEventSourceRef.current.close();
    }

    const streamUrl = `/api/stream?input=${encodeURIComponent(
      query
    )}&threadId=${encodeURIComponent(currentId)}`;
    const eventSource = new EventSource(streamUrl);
    activeEventSourceRef.current = eventSource;

    let accumulatedReport = "";
    let accumulatedSources = [...sources];
    let currentIteration = 1;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "error") {
          setMessages((prev) =>
            prev.map((m, idx) =>
              idx === assistantMsgIndex
                ? {
                    ...m,
                    isStreaming: false,
                    statusText: `Error: ${data.error}`,
                  }
                : m
            )
          );
          setIsSubmitting(false);
          eventSource.close();
          return;
        }

        if (data.type === "step_start") {
          if (data.iteration) currentIteration = data.iteration;
          setMessages((prev) =>
            prev.map((m, idx) =>
              idx === assistantMsgIndex
                ? {
                    ...m,
                    statusText: data.label,
                    iterations: currentIteration,
                  }
                : m
            )
          );
          logTrace(data.step, data.label);
        } else if (data.type === "thinking_chunk") {
          setMessages((prev) =>
            prev.map((m, idx) =>
              idx === assistantMsgIndex
                ? {
                    ...m,
                    thinking: (m.thinking || "") + data.chunk,
                  }
                : m
            )
          );
        } else if (data.type === "query_planned") {
          setMessages((prev) =>
            prev.map((m, idx) =>
              idx === assistantMsgIndex
                ? {
                    ...m,
                    rounds: [
                      ...(m.rounds || []),
                      {
                        iteration: data.iteration,
                        query: data.query,
                        sources: [],
                      },
                    ],
                  }
                : m
            )
          );
          logTrace("planQuery", `Planned query: "${data.query}"`);
        } else if (data.type === "sources_updated") {
          const newSources: SourceItem[] = data.newSources || [];
          const existingUrls = new Set(accumulatedSources.map((s) => s.url));
          newSources.forEach((ns) => {
            if (!existingUrls.has(ns.url)) {
              accumulatedSources.push(ns);
              existingUrls.add(ns.url);
            }
          });
          setSources([...accumulatedSources]);

          // Update current round sources tray
          setMessages((prev) =>
            prev.map((m, idx) => {
              if (idx !== assistantMsgIndex) return m;
              const rounds = [...(m.rounds || [])];
              const lastRound = rounds[rounds.length - 1];
              if (lastRound) {
                lastRound.sources = newSources;
              }
              return { ...m, rounds };
            })
          );
          logTrace(
            "searchTavily",
            `Found ${data.newCount} new sources (${data.totalCount} total accumulated)`
          );
        } else if (data.type === "eval_decision") {
          setMessages((prev) =>
            prev.map((m, idx) => {
              if (idx !== assistantMsgIndex) return m;
              const rounds = [...(m.rounds || [])];
              const lastRound = rounds[rounds.length - 1];
              if (lastRound) {
                lastRound.decision = {
                  sufficient: data.sufficient,
                  reason: data.reason,
                  nextQuery: data.nextQuery,
                };
              }
              return { ...m, rounds };
            })
          );
          logTrace(
            "evaluateSufficiency",
            `Decision: ${data.sufficient ? "SUFFICIENT" : "INSUFFICIENT"} - ${data.reason}`
          );
        } else if (data.type === "report_chunk") {
          accumulatedReport = data.chunk;
          setMessages((prev) =>
            prev.map((m, idx) =>
              idx === assistantMsgIndex
                ? { ...m, report: accumulatedReport }
                : m
            )
          );
        } else if (data.type === "done") {
          const finalRep = data.finalReport || accumulatedReport;
          setMessages((prev) =>
            prev.map((m, idx) =>
              idx === assistantMsgIndex
                ? {
                    ...m,
                    isStreaming: false,
                    statusText: `Completed in ${data.iterations} round(s) • ${data.sources.length} sources`,
                    report: finalRep,
                    iterations: data.iterations,
                  }
                : m
            )
          );
          logTrace(
            "synthesizeReport",
            `Final synthesis complete (${data.sources.length} sources, ${data.knowledgeBase.length} KB cards)`
          );
          setIsSubmitting(false);
          eventSource.close();
          fetchThreads();
        }
      } catch (err) {
        console.error("Stream parse error:", err);
      }
    };

    eventSource.onerror = () => {
      setIsSubmitting(false);
      setMessages((prev) =>
        prev.map((m, idx) =>
          idx === assistantMsgIndex && m.isStreaming
            ? {
                ...m,
                isStreaming: false,
                statusText: "Stream connection completed.",
              }
            : m
        )
      );
      eventSource.close();
      fetchThreads();
    };
  };

  // Client-side initialization on mount
  useEffect(() => {
    fetchThreads().then((thList) => {
      if (typeof window !== "undefined") {
        const savedId = localStorage.getItem("agentic_active_thread_id");
        if (savedId && thList && thList.some((t: ThreadItem) => t.id === savedId)) {
          loadThread(savedId);
        }
      }
    });

    return () => {
      if (activeEventSourceRef.current) {
        activeEventSourceRef.current.close();
      }
    };
  }, []);

  return (
    <>
      <AppHeader
        activeView={activeView}
        onSwitchView={(view) => {
          if (view === "workspace" && !activeThreadId && threads.length > 0) {
            loadThread(threads[0].id);
          } else {
            setActiveView(view);
          }
        }}
        threadCount={threads.length}
        activeThreadTitle={activeThreadTitle}
        onNewThread={() => handleCreateNewThread()}
      />

      {activeView === "threads" ? (
        <ThreadsHubView
          threads={threads}
          activeThreadId={activeThreadId}
          onSelectThread={(id) => loadThread(id)}
          onDeleteThread={(id) => handleDeleteThread(id)}
          onCreateThread={() => handleCreateNewThread()}
        />
      ) : (
        <WorkspaceView
          activeThreadId={activeThreadId}
          activeThreadTitle={activeThreadTitle}
          messages={messages}
          sources={sources}
          kb={kb}
          traces={traces}
          isSubmitting={isSubmitting}
          onBackToThreads={() => setActiveView("threads")}
          onClearThread={handleClearThread}
          onSubmitQuery={handleSubmitQuery}
          onAddToKb={handleAddToKb}
          onClearTraces={handleClearTraces}
        />
      )}
    </>
  );
};
