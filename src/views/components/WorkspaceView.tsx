import React, { useState, useRef, useEffect } from "react";
import MarkdownIt from "markdown-it";
import { VaultDrawer, TraceStep } from "./VaultDrawer.js";
import { SourceItem, KnowledgeBaseEntry } from "../../graphs/state.js";

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
});

export interface MessageItem {
  id?: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string | null;
  report?: string | null;
  iterations?: number | null;
  // Live streaming states
  statusText?: string;
  isStreaming?: boolean;
  rounds?: Array<{
    iteration: number;
    query: string;
    sources?: SourceItem[];
    decision?: { sufficient: boolean; reason: string; nextQuery?: string };
  }>;
}

interface WorkspaceViewProps {
  activeThreadId: string | null;
  activeThreadTitle: string;
  messages: MessageItem[];
  sources: SourceItem[];
  kb: KnowledgeBaseEntry[];
  traces: TraceStep[];
  isSubmitting: boolean;
  onBackToThreads: () => void;
  onClearThread: () => void;
  onSubmitQuery: (query: string) => void;
  onAddToKb: (sources: SourceItem[]) => void;
  onClearTraces: () => void;
}

function extractDomain(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

export const WorkspaceView: React.FC<WorkspaceViewProps> = ({
  activeThreadId,
  activeThreadTitle,
  messages,
  sources,
  kb,
  traces,
  isSubmitting,
  onBackToThreads,
  onClearThread,
  onSubmitQuery,
  onAddToKb,
  onClearTraces,
}) => {
  const [inputText, setInputText] = useState("");
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll chat history when messages change
  useEffect(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [messages]);

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = inputText.trim();
    if (!query || isSubmitting) return;
    setInputText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "48px";
    }
    onSubmitQuery(query);
  };

  return (
    <section
      id="workspace-view"
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        gap: "8px",
      }}
    >
      {/* Workspace Top Sub-bar */}
      <div className="workspace-topbar">
        <div className="workspace-thread-info">
          <button
            id="btn-back-to-threads"
            className="btn-secondary"
            title="Return to All Threads"
            onClick={onBackToThreads}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            <span>All Threads</span>
          </button>

          <div className="workspace-thread-title">
            <span id="current-thread-title">{activeThreadTitle}</span>
            <span
              id="current-thread-badge"
              className="badge"
              style={{ fontSize: "10px" }}
            >
              #{activeThreadId ? activeThreadId.slice(-6) : "new"}
            </span>
          </div>
        </div>

        <div className="workspace-actions">
          <button
            id="btn-clear-chat"
            className="btn-secondary"
            title="Clear messages in this thread"
            onClick={() => {
              if (
                confirm(
                  "Clear all messages and vault sources for this thread?"
                )
              ) {
                onClearThread();
              }
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>Clear Thread</span>
          </button>
        </div>
      </div>

      <section className="workspace">
        {/* Left Panel: Chat & Research Execution Feed */}
        <section className="panel chat-panel">
          <div id="chat-history" className="chat-history" ref={chatHistoryRef}>
            {messages.length === 0 && (
              <div
                style={{
                  padding: "40px",
                  textAlign: "center",
                  color: "var(--muted)",
                }}
              >
                <div style={{ fontSize: "28px", marginBottom: "8px" }}>🔬</div>
                <div style={{ fontSize: "14px", fontWeight: 500 }}>
                  Ready to Research
                </div>
                <div style={{ fontSize: "12px", marginTop: "4px" }}>
                  Ask a question, search for courses, or explore deep topics.
                </div>
              </div>
            )}

            {messages.map((msg, idx) => {
              if (msg.role === "user") {
                return (
                  <div key={msg.id || idx} className="user-message">
                    {msg.content}
                  </div>
                );
              }

              // Assistant Message
              const reportHtml = md.render(msg.report || msg.content || "");

              return (
                <div key={msg.id || idx} className="assistant-message">
                  {/* Stepper only shown if there are streaming steps or rounds */}
                  {(msg.isStreaming ||
                    (msg.rounds && msg.rounds.length > 0) ||
                    msg.thinking) && (
                    <div className="research-stepper">
                      <div className="stepper-header">
                        <div className="stepper-status">
                          {msg.isStreaming && <div className="spinner"></div>}
                          <span>
                            {msg.statusText ||
                              (msg.isStreaming
                                ? "Executing research workflow..."
                                : "Research completed")}
                          </span>
                        </div>
                        <span className="badge badge-accent">
                          Loop {msg.iterations || 1}/3
                        </span>
                      </div>

                      {/* Search Rounds */}
                      {msg.rounds && (
                        <div className="stepper-rounds">
                          {msg.rounds.map((round, ridx) => (
                            <div key={ridx} className="round-node">
                              <div className="round-badge-row">
                                <span className="badge badge-accent">
                                  Round {round.iteration} Search
                                </span>
                                <span className="search-pill">
                                  🔍 {round.query}
                                </span>
                              </div>
                              {round.sources && round.sources.length > 0 && (
                                <div className="sources-tray">
                                  {round.sources.map((s, sidx) => (
                                    <a
                                      key={sidx}
                                      className="source-chip"
                                      href={s.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <span>{extractDomain(s.url)}</span>
                                      <span className="pill-new">+NEW</span>
                                    </a>
                                  ))}
                                </div>
                              )}
                              {round.decision && (
                                <div
                                  className={`decision-box ${
                                    round.decision.sufficient
                                      ? "decision-sufficient"
                                      : "decision-insufficient"
                                  }`}
                                >
                                  <div className="decision-header">
                                    {round.decision.sufficient
                                      ? "✓ Research Concluded"
                                      : "⚡ Need Deeper Search"}
                                  </div>
                                  <div>{round.decision.reason}</div>
                                  {round.decision.nextQuery && (
                                    <div
                                      style={{
                                        fontFamily: "'DM Mono', monospace",
                                        fontSize: "11px",
                                        marginTop: "4px",
                                        color: "var(--ink)",
                                      }}
                                    >
                                      Next targeted query: "
                                      {round.decision.nextQuery}"
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Reasoning Process Block */}
                      {msg.thinking && (
                        <div className="think-block">
                          <details open>
                            <summary>Thinking & Reasoning Process</summary>
                            <div
                              className="think-content"
                              style={{ whiteSpace: "pre-wrap" }}
                            >
                              {msg.thinking}
                            </div>
                          </details>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Final Report Body */}
                  <div
                    className="report-content"
                    dangerouslySetInnerHTML={{ __html: reportHtml }}
                  />
                </div>
              );
            })}
          </div>

          {/* Prompt Composer */}
          <form id="chat-form" className="chat-input-bar" onSubmit={handleSubmit}>
            <textarea
              ref={textareaRef}
              id="chat-input"
              className="text-input"
              placeholder="Research courses, topics, or ask follow-ups for this thread... (Press Enter to Send)"
              rows={1}
              value={inputText}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              disabled={isSubmitting}
            />
            <button
              id="btn-submit"
              type="submit"
              className="btn-send"
              disabled={isSubmitting || !inputText.trim()}
            >
              <span>{isSubmitting ? "Running..." : "Research"}</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </form>
        </section>

        {/* Right Panel: Vault Drawer */}
        <VaultDrawer
          sources={sources}
          kb={kb}
          traces={traces}
          onAddToKb={onAddToKb}
          onClearTraces={onClearTraces}
          activeThreadId={activeThreadId}
        />
      </section>
    </section>
  );
};
