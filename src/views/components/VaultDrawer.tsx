import React, { useState } from "react";
import { SourceItem, KnowledgeBaseEntry } from "../../graphs/state.js";

export interface TraceStep {
  id: string | number;
  node: string;
  desc: string;
  time: string;
}

interface VaultDrawerProps {
  sources: SourceItem[];
  kb: KnowledgeBaseEntry[];
  traces: TraceStep[];
  onAddToKb: (selectedSources: SourceItem[]) => void;
  onClearTraces: () => void;
  activeThreadId?: string | null;
}

function extractDomain(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

export const VaultDrawer: React.FC<VaultDrawerProps> = ({
  sources,
  kb,
  traces,
  onAddToKb,
  onClearTraces,
  activeThreadId,
}) => {
  const [activeTab, setActiveTab] = useState<"sources" | "kb" | "trace">(
    "sources"
  );
  const [sourceSearch, setSourceSearch] = useState("");
  const [unselectedUrls, setUnselectedUrls] = useState<Set<string>>(new Set());
  const [expandedSnippets, setExpandedSnippets] = useState<Set<number>>(
    new Set()
  );
  const [copyFeedback, setCopyFeedback] = useState(false);

  const existingKbUrls = new Set(kb.map((k) => k.sourceUrl));

  // Sources available to select for KB
  const validSelected = sources.filter(
    (s) => !existingKbUrls.has(s.url) && !unselectedUrls.has(s.url)
  );

  const toggleSnippet = (idx: number) => {
    setExpandedSnippets((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleCheckboxChange = (url: string, checked: boolean) => {
    setUnselectedUrls((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  const handleCopyKb = () => {
    if (kb.length === 0) {
      alert("Knowledge Base is currently empty.");
      return;
    }
    navigator.clipboard.writeText(JSON.stringify(kb, null, 2)).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    });
  };

  const handleExportMd = () => {
    if (kb.length === 0) {
      alert("Knowledge Base is currently empty.");
      return;
    }
    let mdText = `# Knowledge Base Export\nGenerated: ${new Date().toLocaleString()}\nThread: ${activeThreadId || "default"}\n\n`;
    kb.forEach((item, idx) => {
      mdText += `## ${idx + 1}. [${item.title}](${item.sourceUrl})\n`;
      mdText += `- **Category:** ${item.category}\n`;
      mdText += `- **Domain:** ${item.domain}\n`;
      mdText += `- **Key Topics:** ${item.keyTopics.join(", ")}\n\n`;
      mdText += `> ${item.summary}\n\n---\n\n`;
    });
    const blob = new Blob([mdText], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `knowledge-base-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredSources = sources.filter((s) => {
    const term = sourceSearch.toLowerCase().trim();
    if (!term) return true;
    return (
      s.title.toLowerCase().includes(term) ||
      s.url.toLowerCase().includes(term) ||
      s.content.toLowerCase().includes(term)
    );
  });

  return (
    <section className="panel vault-panel">
      {/* Tabs Bar */}
      <div className="vault-tabs">
        <button
          className={`vault-tab-btn ${activeTab === "sources" ? "active" : ""}`}
          onClick={() => setActiveTab("sources")}
        >
          <span>🌐 Sources Vault</span>
          <span id="tab-sources-count" className="tab-badge">
            {sources.length}
          </span>
        </button>
        <button
          className={`vault-tab-btn ${activeTab === "kb" ? "active" : ""}`}
          onClick={() => setActiveTab("kb")}
        >
          <span>📚 Knowledge Base</span>
          <span id="tab-kb-count" className="tab-badge">
            {kb.length}
          </span>
        </button>
        <button
          className={`vault-tab-btn ${activeTab === "trace" ? "active" : ""}`}
          onClick={() => setActiveTab("trace")}
        >
          <span>⚡ Graph Trace</span>
          <span id="tab-trace-count" className="tab-badge">
            {traces.length}
          </span>
        </button>
      </div>

      <div className="vault-body">
        {/* TAB 1: Sources Vault */}
        {activeTab === "sources" && (
          <div className="vault-tab-content active">
            <div
              className="vault-toolbar"
              style={{
                display: "flex",
                gap: "8px",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <input
                type="text"
                className="search-filter"
                placeholder="Filter sources by title/domain..."
                value={sourceSearch}
                onChange={(e) => setSourceSearch(e.target.value)}
                style={{ flex: 1, minWidth: "140px" }}
              />
              {validSelected.length > 0 && (
                <button
                  id="btn-add-to-kb"
                  className="btn-primary"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 12px",
                    fontSize: "11px",
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                  }}
                  onClick={() => onAddToKb(validSelected)}
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
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  <span>Add to Knowledge Base</span>
                  <span
                    id="selected-kb-count"
                    className="tab-badge"
                    style={{ background: "rgba(255, 255, 255, 0.25)" }}
                  >
                    {validSelected.length}
                  </span>
                </button>
              )}
              <span
                id="sources-stat"
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: "11px",
                  color: "var(--muted)",
                  marginLeft: "auto",
                }}
              >
                {sources.length} unique sources
              </span>
            </div>

            <div
              id="sources-list"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                overflowY: "auto",
              }}
            >
              {filteredSources.length === 0 ? (
                <div className="vault-empty">
                  <span className="vault-empty-icon">🌐</span>
                  <strong>No sources collected</strong>
                  <p style={{ fontSize: "12px" }}>
                    Run a research query to gather Tavily sources.
                  </p>
                </div>
              ) : (
                filteredSources.map((s, idx) => {
                  const inKB = existingKbUrls.has(s.url);
                  const isChecked = inKB || !unselectedUrls.has(s.url);
                  const isExpanded = expandedSnippets.has(idx);

                  return (
                    <div
                      key={s.id || s.url}
                      className={`source-card ${inKB ? "source-in-kb" : ""}`}
                    >
                      <div className="source-card-header">
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            cursor: inKB ? "default" : "pointer",
                            margin: 0,
                            userSelect: "none",
                          }}
                        >
                          <input
                            type="checkbox"
                            className="source-kb-cb"
                            checked={isChecked}
                            disabled={inKB}
                            onChange={(e) =>
                              handleCheckboxChange(s.url, e.target.checked)
                            }
                            title={
                              inKB
                                ? "Already in Knowledge Base"
                                : "Select for Knowledge Base"
                            }
                            style={{
                              width: "15px",
                              height: "15px",
                              accentColor: inKB
                                ? "var(--emerald, #4ade80)"
                                : "var(--accent)",
                              cursor: inKB ? "not-allowed" : "pointer",
                            }}
                          />
                          <span className="source-domain">
                            {extractDomain(s.url)}
                          </span>
                        </label>
                        <div
                          style={{
                            display: "flex",
                            gap: "5px",
                            alignItems: "center",
                          }}
                        >
                          {inKB && (
                            <span
                              className="badge"
                              style={{
                                color: "var(--emerald, #4ade80)",
                                borderColor: "rgba(16, 185, 129, 0.35)",
                                background: "rgba(16, 185, 129, 0.1)",
                                fontSize: "10px",
                              }}
                            >
                              ✓ In Knowledge Base
                            </span>
                          )}
                          <span className="badge" style={{ fontSize: "10px" }}>
                            Round {s.iteration || 1}
                          </span>
                          {s.isNew && <span className="pill-new">NEW</span>}
                        </div>
                      </div>
                      <a
                        className="source-card-title"
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {s.title}
                      </a>
                      <div
                        className={`source-snippet ${isExpanded ? "expanded" : ""}`}
                      >
                        {s.content}
                      </div>
                      <button
                        className="btn-expand-snippet"
                        onClick={() => toggleSnippet(idx)}
                      >
                        Toggle Excerpt
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 2: Knowledge Base */}
        {activeTab === "kb" && (
          <div className="vault-tab-content active">
            <div className="vault-toolbar">
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  id="btn-copy-kb"
                  className="btn-secondary"
                  title="Copy Knowledge Base as JSON"
                  onClick={handleCopyKb}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  {copyFeedback ? "✓ Copied!" : "Copy JSON"}
                </button>
                <button
                  id="btn-download-kb"
                  className="btn-secondary"
                  title="Download as Markdown"
                  onClick={handleExportMd}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Export MD
                </button>
              </div>
              <span
                id="kb-stat"
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: "11px",
                  color: "var(--muted)",
                }}
              >
                {kb.length} items ready
              </span>
            </div>

            <div
              id="kb-list"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                overflowY: "auto",
              }}
            >
              {kb.length === 0 ? (
                <div className="vault-empty">
                  <span className="vault-empty-icon">📚</span>
                  <strong>Knowledge Base Empty</strong>
                  <p style={{ fontSize: "12px" }}>
                    Extracted course curricula & guides will appear here.
                  </p>
                </div>
              ) : (
                kb.map((item) => {
                  const catClass =
                    "category-" + (item.category || "resource").toLowerCase();
                  return (
                    <div key={item.id || item.sourceUrl} className="kb-card">
                      <div className="kb-card-header">
                        <span className={`kb-category ${catClass}`}>
                          {item.category}
                        </span>
                        <span
                          style={{
                            fontFamily: "'DM Mono', monospace",
                            fontSize: "11px",
                            color: "var(--muted)",
                          }}
                        >
                          {item.domain}
                        </span>
                      </div>
                      <a
                        className="kb-card-title"
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {item.title}
                      </a>
                      <p className="kb-card-summary">{item.summary}</p>
                      <div className="kb-tags">
                        {item.keyTopics.map((t, tidx) => (
                          <span key={tidx} className="kb-tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 3: Graph Execution Trace */}
        {activeTab === "trace" && (
          <div className="vault-tab-content active">
            <div className="vault-toolbar">
              <span
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: "11px",
                  color: "var(--muted)",
                }}
              >
                LangGraph Execution Telemetry
              </span>
              <button
                id="btn-clear-trace"
                className="btn-secondary"
                style={{ fontSize: "11px", padding: "3px 8px" }}
                onClick={onClearTraces}
              >
                Clear
              </button>
            </div>
            <div
              id="trace-list"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                overflowY: "auto",
                padding: "6px 0",
              }}
            >
              {traces.length === 0 ? (
                <div className="vault-empty">
                  <span className="vault-empty-icon">⚡</span>
                  <strong>No trace events recorded</strong>
                  <p style={{ fontSize: "12px" }}>
                    Node telemetry will log in real time as the graph executes.
                  </p>
                </div>
              ) : (
                traces.map((step, idx) => {
                  let iconClass = "trace-plan";
                  let iconChar = "💭";
                  if (step.node === "searchTavily") {
                    iconClass = "trace-search";
                    iconChar = "🔍";
                  } else if (step.node === "evaluateSufficiency") {
                    iconClass = "trace-eval";
                    iconChar = "🧠";
                  } else if (step.node === "synthesizeReport") {
                    iconClass = "trace-synth";
                    iconChar = "📝";
                  }

                  return (
                    <div key={idx} className="trace-step">
                      <div className={`trace-icon ${iconClass}`}>
                        {iconChar}
                      </div>
                      <div className="trace-info">
                        <div className="trace-info-header">
                          <span className="trace-node-name">{step.node}</span>
                          <span className="trace-time">{step.time}</span>
                        </div>
                        <div className="trace-desc">{step.desc}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
