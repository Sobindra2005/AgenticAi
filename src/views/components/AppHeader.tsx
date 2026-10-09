import React from "react";

interface AppHeaderProps {
  activeView: "threads" | "workspace";
  onSwitchView: (view: "threads" | "workspace") => void;
  threadCount: number;
  activeThreadTitle?: string;
  onNewThread: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  activeView,
  onSwitchView,
  threadCount,
  activeThreadTitle,
  onNewThread,
}) => {
  const workspaceLabel = activeThreadTitle
    ? activeThreadTitle.length > 18
      ? activeThreadTitle.slice(0, 18) + "..."
      : activeThreadTitle
    : "Active Workspace";

  return (
    <header className="app-header">
      <div className="brand-group">
        <div className="brand-logo">
          <div className="logo-dot"></div>
          <span>Agentic AI Studio</span>
        </div>
        <div className="model-badges">
          <span className="badge badge-accent">LangGraph v1.4</span>
          <span className="badge badge-cyan">DeepSeek-R1</span>
          <span className="badge badge-orange">Tavily Search</span>
        </div>
      </div>

      <div className="nav-tabs">
        <button
          id="nav-btn-threads"
          className={`nav-tab-btn ${activeView === "threads" ? "active" : ""}`}
          title="Browse all research threads"
          onClick={() => onSwitchView("threads")}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="7" height="7"></rect>
            <rect x="14" y="3" width="7" height="7"></rect>
            <rect x="14" y="14" width="7" height="7"></rect>
            <rect x="3" y="14" width="7" height="7"></rect>
          </svg>
          <span>Threads Hub</span>
          <span id="nav-threads-count" className="tab-badge">
            {threadCount}
          </span>
        </button>

        <button
          id="nav-btn-workspace"
          className={`nav-tab-btn ${activeView === "workspace" ? "active" : ""}`}
          title="Open active research workspace"
          onClick={() => onSwitchView("workspace")}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <span id="nav-workspace-label">{workspaceLabel}</span>
        </button>
      </div>

      <div className="header-actions">
        <button
          id="btn-new-thread-top"
          className="btn-primary-accent"
          title="Start a fresh isolated research thread"
          onClick={onNewThread}
        >
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
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>New Thread</span>
        </button>
      </div>
    </header>
  );
};
