import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from "react";
import MarkdownIt from "markdown-it";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
import { VaultDrawer, TraceStep } from "./VaultDrawer.js";
import { SourceItem, KnowledgeBaseEntry } from "../../graphs/state.js";
import { MermaidDiagram } from "./MermaidDiagram.js";
import { MessageSkeleton } from "./skeletons/index.js";

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true,
});

// Wrap markdown tables in responsive horizontal scroll containers
md.renderer.rules.table_open = () => '<div class="table-container"><table>';
md.renderer.rules.table_close = () => '</table></div>';

export interface MessageItem {
  id?: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string | null;
  report?: string | null;
  iterations?: number | null;
  sources?: SourceItem[];
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
  isLoadingMessages?: boolean;
  isLoadingSources?: boolean;
  isLoadingKb?: boolean;
  isLoadingTraces?: boolean;
  hasMoreMessages?: boolean;
  isLoadingOlderMessages?: boolean;
  totalMessagesCount?: number;
  onLoadOlderMessages?: () => void;
  onBackToThreads: () => void;
  onClearThread: () => void;
  onSubmitQuery: (query: string) => void;
  onAddToKb: (sources: SourceItem[]) => void;
  onClearTraces: () => void;
  onUpdateMessageReport?: (messageIdentifier: string | number, updatedReport: string) => void;
}

type ReportSegment =
  | { type: "markdown"; content: string }
  | { type: "mermaid"; content: string }
  | { type: "mermaid-streaming"; content: string };

type RenderedSegment =
  | { type: "mermaid"; content: string }
  | { type: "mermaid-streaming"; content: string }
  | { type: "markdown"; content: string; html: string };

function parseReportSegments(reportText: string): ReportSegment[] {
  if (!reportText) return [];

  const segments: ReportSegment[] = [];
  const mermaidRegex = /```mermaid\s*([\s\S]*?)(?:```|$)/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mermaidRegex.exec(reportText)) !== null) {
    const fullMatch = match[0];
    const startIndex = match.index;

    if (startIndex > lastIndex) {
      const mdChunk = reportText.slice(lastIndex, startIndex);
      if (mdChunk.trim().length > 0) {
        segments.push({ type: "markdown", content: mdChunk });
      }
    }

    const isClosed = fullMatch.endsWith("```");
    const innerCode = match[1]?.trim() || "";

    if (isClosed && innerCode.length > 0) {
      segments.push({ type: "mermaid", content: innerCode });
    } else if (!isClosed) {
      segments.push({ type: "mermaid-streaming", content: innerCode });
    }

    lastIndex = startIndex + fullMatch.length;
  }

  if (lastIndex < reportText.length) {
    const remaining = reportText.slice(lastIndex);
    if (remaining.trim().length > 0) {
      segments.push({ type: "markdown", content: remaining });
    }
  }

  if (segments.length === 0 && reportText.length > 0) {
    segments.push({ type: "markdown", content: reportText });
  }

  return segments;
}

function extractDomain(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

function escapeHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Transforms plain bracket citations like [1], [2], [1, 2] in HTML
 * into interactive, hoverable pills with floating source preview cards
 * and direct links to the verified source URL.
 */
function enhanceCitationsWithTooltips(html: string, sourcesList: SourceItem[]): string {
  if (!html) return "";
  if (!sourcesList || sourcesList.length === 0) return html;

  // Split HTML so code blocks (<pre> and <code>) and existing anchor tags (<a>) are untouched
  const parts = html.split(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>|<a\b[\s\S]*?<\/a>)/gi);

  return parts
    .map((part, index) => {
      // Odd indices are protected tags
      if (index % 2 === 1) return part;

      // Replace bracketed citations: [1], [2], [1, 2], [1, 2, 3]
      return part.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (match, numsStr) => {
        const numbers = numsStr
          .split(",")
          .map((n: string) => parseInt(n.trim(), 10))
          .filter((n: number) => !isNaN(n));

        if (numbers.length === 0) return match;

        const pills = numbers
          .map((num: number) => {
            const sourceIndex = num - 1;
            const source = sourcesList[sourceIndex];

            if (!source || !source.url) {
              return `<span class="citation-pill citation-pill-unknown" title="Source ${num}">[${num}]</span>`;
            }

            const domain = extractDomain(source.url);
            const title = escapeHtml(source.title || "Source Reference");
            const rawSnippet = (source.content || "").replace(/\s+/g, " ").trim();
            const snippet = escapeHtml(
              rawSnippet.slice(0, 150) + (rawSnippet.length > 150 ? "..." : "")
            );

            return `
<span class="citation-wrapper">
  <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" class="citation-pill" data-citation="${num}">
    [${num}]
  </a>
  <span class="citation-tooltip" role="tooltip">
    <span class="citation-tooltip-header">
      <span class="citation-tooltip-badge">Source [${num}]</span>
      <span class="citation-tooltip-domain">${escapeHtml(domain)}</span>
    </span>
    <span class="citation-tooltip-title">${title}</span>
    ${snippet ? `<span class="citation-tooltip-snippet">${snippet}</span>` : ""}
    <span class="citation-tooltip-footer">Click to open source ↗</span>
  </span>
</span>`.trim();
          })
          .join("");

        return `<span class="citation-group">${pills}</span>`;
      });
    })
    .join("");
}

interface MessageItemViewProps {
  msg: MessageItem;
  idx: number;
  sources: SourceItem[];
  activeThreadId: string | null;
  onUpdateMessageReport?: (messageIdentifier: string | number, updatedReport: string) => void;
}

const MessageItemView = React.memo<MessageItemViewProps>(
  ({ msg, idx, sources, activeThreadId, onUpdateMessageReport }) => {
    if (msg.role === "user") {
      return (
        <div key={msg.id || idx} className="user-message">
          {msg.content}
        </div>
      );
    }

    // Assistant Message
    const effectiveSources = msg.sources && msg.sources.length > 0 ? msg.sources : sources;

    // Memoize the rendered markdown and segments so completed reports are never re-parsed
    const renderedReportSegments = useMemo<RenderedSegment[]>(() => {
      const rawReport = msg.report || msg.content || "";
      if (!rawReport) return [];

      return parseReportSegments(rawReport).map((segment): RenderedSegment => {
        if (segment.type === "markdown") {
          return {
            type: "markdown",
            content: segment.content,
            html: enhanceCitationsWithTooltips(
              md.render(segment.content),
              effectiveSources
            ),
          };
        }
        return segment;
      });
    }, [msg.report, msg.content, effectiveSources]);

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
        <div className="report-content">
          {renderedReportSegments.map((segment, segIdx) => {
            if (segment.type === "mermaid") {
              return (
                <MermaidDiagram
                  key={`mermaid-${msg.id || idx}-${segIdx}`}
                  code={segment.content}
                  messageId={msg.id}
                  threadId={activeThreadId || undefined}
                  fullReport={msg.report || msg.content || ""}
                  onCodeRepaired={(oldCode, newCode) => {
                    if (onUpdateMessageReport) {
                      const currentRep = msg.report || msg.content || "";
                      const updated = currentRep.replace(oldCode, newCode);
                      onUpdateMessageReport(msg.id || idx, updated);
                    }
                  }}
                />
              );
            }

            if (segment.type === "mermaid-streaming") {
              return (
                <div key={`streaming-${segIdx}`} className="mermaid-diagram-card">
                  <div className="mermaid-card-body">
                    <div className="mermaid-status-box validating">
                      <div className="spinner"></div>
                      <span>Generating Mermaid diagram...</span>
                    </div>
                  </div>
                </div>
              );
            }

            // Regular Markdown segment
            return (
              <div
                key={`md-${segIdx}`}
                className="report-markdown-segment"
                dangerouslySetInnerHTML={{ __html: segment.html }}
              />
            );
          })}
        </div>
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.msg === next.msg &&
      prev.idx === next.idx &&
      prev.sources === next.sources &&
      prev.activeThreadId === next.activeThreadId &&
      prev.onUpdateMessageReport === next.onUpdateMessageReport
    );
  }
);

interface PromptComposerProps {
  isSubmitting: boolean;
  onSubmit: (query: string) => void;
}

/**
 * Isolated PromptComposer component.
 * Maintains its own local input state so that typing in the prompt bar
 * re-renders ONLY this composer and never the parent WorkspaceView or
 * the massive message history, eliminating all typing lag and jitter.
 */
const PromptComposer = React.memo<PromptComposerProps>(({ isSubmitting, onSubmit }) => {
  const [inputText, setInputText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    const target = e.target;
    // Auto-expand with max-height
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
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
    onSubmit(query);
  };

  return (
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
  );
});

export const WorkspaceView: React.FC<WorkspaceViewProps> = ({
  activeThreadId,
  activeThreadTitle,
  messages,
  sources,
  kb,
  traces,
  isSubmitting,
  isLoadingMessages = false,
  isLoadingSources = false,
  isLoadingKb = false,
  isLoadingTraces = false,
  hasMoreMessages = false,
  isLoadingOlderMessages = false,
  totalMessagesCount,
  onLoadOlderMessages,
  onBackToThreads,
  onClearThread,
  onSubmitQuery,
  onAddToKb,
  onClearTraces,
  onUpdateMessageReport,
}) => {
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = useState(false);
  const isAutoScrollEnabled = useRef(true);
  const isInitialThreadLoadRef = useRef(true);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const lastScrollTopRef = useRef<number>(0);
  const touchStartYRef = useRef<number | null>(null);
  const prevScrollHeightRef = useRef<number | null>(null);

  const handleLoadEarlier = useCallback(() => {
    if (isLoadingOlderMessages) return;
    if (chatHistoryRef.current) {
      prevScrollHeightRef.current = chatHistoryRef.current.scrollHeight;
      isAutoScrollEnabled.current = false;
      isInitialThreadLoadRef.current = false;
    }
    onLoadOlderMessages?.();
  }, [isLoadingOlderMessages, onLoadOlderMessages]);

  // Scroll to bottom helper
  const scrollToBottom = (smooth = false) => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTo({
        top: chatHistoryRef.current.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
      isAutoScrollEnabled.current = true;
      isInitialThreadLoadRef.current = false;
      setShowScrollBottom(false);
      setHasNewMessagesBelow(false);
    }
  };

  // Immediate disengagement of auto-scroll when user spins wheel UP
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) {
      isAutoScrollEnabled.current = false;
      isInitialThreadLoadRef.current = false;
    }
  };

  // Immediate disengagement of auto-scroll when user touches/swipes to scroll UP
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartYRef.current !== null && e.touches[0]) {
      const currentY = e.touches[0].clientY;
      if (currentY > touchStartYRef.current) {
        isAutoScrollEnabled.current = false;
        isInitialThreadLoadRef.current = false;
      }
    }
  };

  // Detect whether user is at bottom or manually scrolled up
  const handleScroll = () => {
    if (!chatHistoryRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatHistoryRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const prevScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = scrollTop;

    // On-demand auto-load when user scrolls near the top
    if (scrollTop <= 15 && hasMoreMessages && !isLoadingOlderMessages && onLoadOlderMessages) {
      if (chatHistoryRef.current) {
        prevScrollHeightRef.current = chatHistoryRef.current.scrollHeight;
        isAutoScrollEnabled.current = false;
        isInitialThreadLoadRef.current = false;
      }
      onLoadOlderMessages();
    }

    // Any upward scroll immediately disables auto-scrolling
    if (scrollTop < prevScrollTop - 1) {
      isAutoScrollEnabled.current = false;
      isInitialThreadLoadRef.current = false;
    } else if (distanceFromBottom <= 20) {
      // Re-enable auto-scroll when user intentionally scrolls back down to the very bottom
      isAutoScrollEnabled.current = true;
    }

    // Toggle scroll-to-latest button visibility
    const isAtBottom = distanceFromBottom <= 30;
    if (isAtBottom) {
      setShowScrollBottom(false);
      setHasNewMessagesBelow(false);
    } else {
      setShowScrollBottom(true);
    }
  };

  // Reset initial load flag when activeThreadId changes
  useIsomorphicLayoutEffect(() => {
    isInitialThreadLoadRef.current = true;
    isAutoScrollEnabled.current = true;
    setShowScrollBottom(false);
    setHasNewMessagesBelow(false);
  }, [activeThreadId]);

  // Synchronous layout scroll: snaps instantly to bottom before browser paint
  useIsomorphicLayoutEffect(() => {
    // If older messages were prepended to the top (pagination), preserve previous scroll view
    if (prevScrollHeightRef.current !== null && chatHistoryRef.current) {
      const heightDifference = chatHistoryRef.current.scrollHeight - prevScrollHeightRef.current;
      if (heightDifference > 0) {
        chatHistoryRef.current.scrollTop += heightDifference;
      }
      prevScrollHeightRef.current = null;
      return;
    }

    const container = chatHistoryRef.current;
    if (!container) return;

    // When thread messages arrive initially: snap directly to bottom before paint
    if (isInitialThreadLoadRef.current) {
      if (messages.length > 0 && !isLoadingMessages) {
        container.scrollTop = container.scrollHeight;
        lastScrollTopRef.current = container.scrollHeight;
        isInitialThreadLoadRef.current = false;
        setShowScrollBottom(false);
        setHasNewMessagesBelow(false);
      }
      return;
    }

    // Live streaming or newly added user/assistant messages: keep glued to bottom
    if (isAutoScrollEnabled.current) {
      container.scrollTop = container.scrollHeight;
      lastScrollTopRef.current = container.scrollHeight;
      setShowScrollBottom(false);
      setHasNewMessagesBelow(false);
    } else {
      setShowScrollBottom(true);
      if (isSubmitting) {
        setHasNewMessagesBelow(true);
      }
    }
  }, [messages, isLoadingMessages, isSubmitting]);

  // ResizeObserver: keeps pinned to bottom if diagrams, fonts, or markdown expand
  useEffect(() => {
    const container = chatHistoryRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (isInitialThreadLoadRef.current || isAutoScrollEnabled.current) {
        container.scrollTop = container.scrollHeight;
        lastScrollTopRef.current = container.scrollHeight;
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [activeThreadId]);

  const handlePromptSubmit = useCallback(
    (query: string) => {
      isAutoScrollEnabled.current = true;
      setShowScrollBottom(false);
      setHasNewMessagesBelow(false);
      setTimeout(() => {
        scrollToBottom(true);
      }, 50);
      onSubmitQuery(query);
    },
    [onSubmitQuery]
  );

  // Dynamically adjust citation tooltip alignment & vertical flip so it is never clipped
  const handleCitationMouseOver = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const wrapper = target.closest(".citation-wrapper") as HTMLElement | null;
    if (!wrapper) return;

    const tooltip = wrapper.querySelector(".citation-tooltip") as HTMLElement | null;
    if (!tooltip) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const chatContainer = chatHistoryRef.current;
    const containerRect = chatContainer
      ? chatContainer.getBoundingClientRect()
      : { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };

    // If near top of scrollable container or viewport, flip downwards
    const spaceAbove = wrapperRect.top - containerRect.top;
    if (spaceAbove < 140) {
      tooltip.classList.add("tooltip-bottom");
    } else {
      tooltip.classList.remove("tooltip-bottom");
    }

    // Check horizontal boundaries to avoid clipping left/right
    const halfWidth = 145; // Tooltip is 290px wide
    const centerX = wrapperRect.left + wrapperRect.width / 2;

    if (centerX - halfWidth < containerRect.left + 8) {
      tooltip.classList.add("tooltip-align-left");
      tooltip.classList.remove("tooltip-align-right");
    } else if (centerX + halfWidth > containerRect.right - 8) {
      tooltip.classList.add("tooltip-align-right");
      tooltip.classList.remove("tooltip-align-left");
    } else {
      tooltip.classList.remove("tooltip-align-left");
      tooltip.classList.remove("tooltip-align-right");
    }
  }, []);

  return (
    <section id="workspace-view" className="workspace-view">
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
          <div
            id="chat-history"
            className="chat-history"
            ref={chatHistoryRef}
            onScroll={handleScroll}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onMouseOver={handleCitationMouseOver}
          >
            {/* Pagination Controls at Top of Chat History */}
            {hasMoreMessages && (
              <div className="history-pagination-bar">
                <button
                  type="button"
                  id="btn-load-older-messages"
                  className="btn-load-older"
                  onClick={handleLoadEarlier}
                  disabled={isLoadingOlderMessages}
                >
                  {isLoadingOlderMessages ? (
                    <>
                      <div className="spinner-small" />
                      <span>Loading earlier messages...</span>
                    </>
                  ) : (
                    <>
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
                        <polyline points="18 15 12 9 6 15" />
                      </svg>
                      <span>
                        Load earlier messages
                        {totalMessagesCount !== undefined && totalMessagesCount > messages.length && (
                          <span className="load-count-badge">
                            {totalMessagesCount - messages.length} remaining
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </button>
              </div>
            )}

            {!hasMoreMessages && messages.length > 0 && (
              <div className="history-start-marker">
                <span>Beginning of research conversation ({messages.length} messages)</span>
              </div>
            )}

            {isLoadingMessages ? (
              <MessageSkeleton />
            ) : messages.length === 0 ? (
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
            ) : (
              messages.map((msg, idx) => (
                <MessageItemView
                  key={msg.id || idx}
                  msg={msg}
                  idx={idx}
                  sources={sources}
                  activeThreadId={activeThreadId}
                  onUpdateMessageReport={onUpdateMessageReport}
                />
              ))
            )}
          </div>

          {/* Scroll to latest floating pill */}
          {showScrollBottom && (
            <button
              id="btn-scroll-latest"
              type="button"
              className="btn-scroll-latest"
              onClick={() => scrollToBottom(true)}
              title="Scroll to latest messages"
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
                <polyline points="19 12 12 19 5 12"></polyline>
              </svg>
              <span>
                {hasNewMessagesBelow ? "New messages below ↓" : "Scroll to latest"}
              </span>
            </button>
          )}

          {/* Prompt Composer (Isolated to eliminate typing jitter) */}
          <PromptComposer
            isSubmitting={isSubmitting}
            onSubmit={handlePromptSubmit}
          />
        </section>

        {/* Right Panel: Vault Drawer */}
        <VaultDrawer
          sources={sources}
          kb={kb}
          traces={traces}
          isLoadingSources={isLoadingSources}
          isLoadingKb={isLoadingKb}
          isLoadingTraces={isLoadingTraces}
          onAddToKb={onAddToKb}
          onClearTraces={onClearTraces}
          activeThreadId={activeThreadId}
        />
      </section>
    </section>
  );
};
