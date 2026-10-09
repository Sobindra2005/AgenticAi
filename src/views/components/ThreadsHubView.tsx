import React, { useState } from "react";

export interface ThreadItem {
  id: string;
  title: string;
  createdAt: number | string | Date;
  updatedAt: number | string | Date;
  messageCount: number;
  sourceCount: number;
  kbCount: number;
  lastSnippet?: string | null;
  summary?: string | null;
}

interface ThreadsHubViewProps {
  threads: ThreadItem[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onDeleteThread: (id: string) => void;
  onCreateThread: () => void;
}

function formatRelativeTime(timestamp?: number | string | Date): string {
  if (!timestamp) return "Just now";
  const timeVal =
    typeof timestamp === "number"
      ? timestamp
      : new Date(timestamp).getTime();
  if (isNaN(timeVal)) return "Just now";
  const diffMs = Date.now() - timeVal;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export const ThreadsHubView: React.FC<ThreadsHubViewProps> = ({
  threads,
  activeThreadId,
  onSelectThread,
  onDeleteThread,
  onCreateThread,
}) => {
  const [searchTerm, setSearchTerm] = useState("");

  const term = searchTerm.toLowerCase().trim();
  const filteredThreads = threads.filter(
    (t) =>
      t.title.toLowerCase().includes(term) ||
      (t.lastSnippet && t.lastSnippet.toLowerCase().includes(term)) ||
      t.id.toLowerCase().includes(term)
  );

  return (
    <section id="threads-view" className="threads-view">
      <div className="threads-toolbar">
        <div className="threads-search-bar">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--muted)" }}
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            id="threads-search"
            placeholder="Search threads by topic, query, or ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <span id="threads-stat-label" className="threads-count-badge">
          {threads.length} active thread{threads.length === 1 ? "" : "s"}
        </span>
      </div>

      <div id="threads-grid" className="threads-grid">
        {/* Create New Thread Card */}
        <div
          id="card-create-thread"
          className="thread-card-create"
          onClick={onCreateThread}
        >
          <div className="thread-create-icon">
            <svg
              width="22"
              height="22"
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
          </div>
          <div className="thread-create-title">Start New Thread</div>
          <p className="thread-create-desc">
            Spawn an isolated, fresh research context with independent sources,
            reasoning traces, and memory checkpointing.
          </p>
        </div>

        {/* Filtered Thread Cards */}
        {filteredThreads.length === 0 && term ? (
          <div
            style={{
              gridColumn: "1 / -1",
              padding: "40px",
              textAlign: "center",
              color: "var(--muted)",
              background: "var(--panel-card)",
              borderRadius: "12px",
              border: "1px solid var(--line)",
            }}
          >
            <p style={{ fontSize: "14px" }}>
              No threads found matching "{searchTerm}".
            </p>
          </div>
        ) : (
          filteredThreads.map((thread) => {
            const isActive = thread.id === activeThreadId;
            const timeStr = formatRelativeTime(
              thread.updatedAt || thread.createdAt
            );
            const snippet =
              thread.lastSnippet ||
              "New research thread ready. Enter a topic to begin.";

            return (
              <div
                key={thread.id}
                className={`thread-card ${isActive ? "active-thread-card" : ""}`}
                data-id={thread.id}
                onClick={() => onSelectThread(thread.id)}
              >
                <div className="thread-card-header">
                  <div className="thread-card-title-group">
                    <div className="thread-card-title" title={thread.title}>
                      {thread.title}
                    </div>
                    <div className="thread-card-meta">
                      <span>#{thread.id.slice(-6)}</span>
                      <span>•</span>
                      <span>{timeStr}</span>
                    </div>
                  </div>
                  <button
                    className="thread-delete-btn"
                    title="Delete thread"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (
                        confirm(
                          "Are you sure you want to delete this research thread? All messages and sources in this thread will be removed."
                        )
                      ) {
                        onDeleteThread(thread.id);
                      }
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>

                <div className="thread-card-snippet">{snippet}</div>

                <div className="thread-card-footer">
                  <div className="thread-metrics-group">
                    <span className="thread-metric" title="Turns / Messages">
                      <span>💬</span>
                      <span>{thread.messageCount || 0}</span>
                    </span>
                    <span className="thread-metric" title="Sources Vault">
                      <span>🌐</span>
                      <span>{thread.sourceCount || 0}</span>
                    </span>
                    <span
                      className="thread-metric"
                      title="Knowledge Base items"
                    >
                      <span>📚</span>
                      <span>{thread.kbCount || 0}</span>
                    </span>
                  </div>
                  <span className="thread-open-link">
                    <span>Open Chat</span>
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
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                      <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
