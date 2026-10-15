import React, { useState, useEffect, useRef, useCallback } from "react";

export interface SelfHealTrace {
  healId: string;
  modelUsed: string;
  strategy?: string;
  durationMs: number;
  originalError: string;
  originalCode: string;
  repairedCode: string;
  timestamp: string;
  attempt: number;
  status: "success" | "failed";
  reasoningSnippet?: string;
}

interface MermaidDiagramProps {
  code: string;
  messageId?: string;
  threadId?: string;
  fullReport?: string;
  onCodeRepaired?: (oldCode: string, newCode: string) => void;
}

/**
 * Fast client-side sanitizer for common Mermaid syntax errors:
 * - Wraps unquoted node labels containing ( ) : & / in double quotes
 * - Normalizes reserved keyword node IDs
 */
function sanitizeMermaidSyntax(raw: string): string {
  if (!raw) return "";

  let cleaned = raw
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Strip leading 'mermaid' if model output had ```\nmermaid\nflowchart
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

  cleaned = cleaned.replace(/\b(end|subgraph|graph)\s*\[/gi, "node_$1[");
  cleaned = cleaned.replace(/\b(end|subgraph|graph)\s*\(/gi, "node_$1(");

  return cleaned.trim();
}

/**
 * Normalizes rendered Mermaid SVG so wide diagrams are NEVER squeezed down or zoomed out.
 * Preserves the natural viewBox width and comfortable readability.
 */
function normalizeMermaidSvg(rawSvg: string): string {
  if (!rawSvg) return "";

  const vbMatch = rawSvg.match(/viewBox=["']([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)["']/i);
  if (!vbMatch) return rawSvg;

  const naturalWidth = parseFloat(vbMatch[3]);
  if (!naturalWidth || isNaN(naturalWidth)) return rawSvg;

  // For narrow vertical diagrams (< 450px), boost width slightly so text is spacious
  let targetWidth = naturalWidth;
  if (naturalWidth < 450) {
    targetWidth = Math.round(naturalWidth * 1.3);
  }

  // Remove width="100%" and set explicit min-width so wide diagrams preserve full readability
  let modified = rawSvg
    .replace(/\bwidth=["']100%["']/i, `width="${targetWidth}px"`)
    .replace(/style=["']([^"']*)["']/i, (match, existingStyle) => {
      const cleaned = existingStyle.replace(/max-width:[^;]+;?/gi, "").trim();
      return `style="${cleaned}; min-width: ${targetWidth}px; width: ${targetWidth}px; max-width: none;"`;
    });

  return modified;
}

export const MermaidDiagram: React.FC<MermaidDiagramProps> = React.memo(({
  code,
  messageId,
  threadId,
  fullReport,
  onCodeRepaired,
}) => {
  const [currentCode, setCurrentCode] = useState<string>(code);
  const [status, setStatus] = useState<"validating" | "rendered" | "healing" | "error">("validating");
  const [svgHtml, setSvgHtml] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview");
  const [copied, setCopied] = useState(false);
  const [copiedDebug, setCopiedDebug] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // Pan & Zoom Interactive Canvas State
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const startPanRef = useRef<{ startX: number; startY: number; initialPanX: number; initialPanY: number }>({
    startX: 0,
    startY: 0,
    initialPanX: 0,
    initialPanY: 0,
  });

  // Self-Healing Tracking State
  const [debugTrace, setDebugTrace] = useState<SelfHealTrace | null>(null);
  const [showDebugDrawer, setShowDebugDrawer] = useState(false);

  // Full Screen Mode State & Card Ref
  const [isFullscreen, setIsFullscreen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasLayerRef = useRef<HTMLDivElement>(null);
  const [isPannable, setIsPannable] = useState(false);
  const isHealingRef = useRef(false);
  const attemptsRef = useRef(0);
  const MAX_ATTEMPTS = 2;
  const prevPropCodeRef = useRef(code);

  // Synchronize when parent prop code changes (e.g. streaming or switching threads)
  useEffect(() => {
    if (code !== prevPropCodeRef.current) {
      prevPropCodeRef.current = code;
      if (code !== currentCode) {
        attemptsRef.current = 0;
        setCurrentCode(code);
        setErrorMessage("");
        setPan({ x: 0, y: 0 });
        setZoom(1.0);
      }
    }
  }, [code, currentCode]);

  // Validate and render diagram
  useEffect(() => {
    let isCancelled = false;

    async function renderDiagram(codeToRender: string) {
      if (typeof window === "undefined") return;

      const mermaid = (window as any).mermaid;
      if (!mermaid) {
        // Wait briefly for CDN script if still loading
        const timer = setTimeout(() => {
          if (!isCancelled) renderDiagram(codeToRender);
        }, 300);
        return () => clearTimeout(timer);
      }

      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            darkMode: true,
            background: "transparent",
            mainBkg: "#0f172a",
            nodeBorder: "#38bdf8",
            nodeTextColor: "#f8fafc",
            primaryColor: "#0f172a",
            primaryTextColor: "#f8fafc",
            primaryBorderColor: "#38bdf8",
            lineColor: "#38bdf8",
            secondaryColor: "#1e293b",
            tertiaryColor: "#0b0f19",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "14px",
            edgeLabelBackground: "#080c14",
            clusterBkg: "rgba(15, 23, 42, 0.6)",
            clusterBorder: "#334155",
            titleColor: "#38bdf8",
          },
          flowchart: {
            useMaxWidth: false,
            htmlLabels: true,
            curve: "basis",
            padding: 16,
            nodeSpacing: 40,
            rankSpacing: 44,
          },
          sequence: {
            useMaxWidth: false,
            boxMargin: 12,
            boxTextMargin: 6,
            noteMargin: 12,
            messageMargin: 36,
          },
          securityLevel: "loose",
          suppressErrorRendering: true,
        });

        // 1. Validate syntax via mermaid.parse
        setStatus("validating");
        await mermaid.parse(codeToRender);

        // 2. Render SVG
        const uniqueId = "mermaid-" + Math.random().toString(36).substring(2, 9);
        const { svg } = await mermaid.render(uniqueId, codeToRender);

        if (!isCancelled) {
          setSvgHtml(normalizeMermaidSvg(svg));
          setStatus("rendered");
          setErrorMessage("");
        }
      } catch (parseError: any) {
        if (isCancelled) return;
        const errText = parseError?.message || String(parseError);
        console.warn("[MermaidDiagram] Syntax validation failed:", errText);

        // 1. Fast Client-side Heuristic Self-Heal Check (Instant)
        const quickSanitized = sanitizeMermaidSyntax(codeToRender);
        if (quickSanitized !== codeToRender) {
          try {
            await mermaid.parse(quickSanitized);
            const uniqueId = "mermaid-quick-" + Math.random().toString(36).substring(2, 9);
            const { svg } = await mermaid.render(uniqueId, quickSanitized);

            if (!isCancelled) {
              const trace: SelfHealTrace = {
                healId: Math.random().toString(36).substring(2, 8),
                modelUsed: "heuristic-sanitizer",
                strategy: "instant-regex-prepass",
                durationMs: 4,
                originalError: errText,
                originalCode: codeToRender,
                repairedCode: quickSanitized,
                timestamp: new Date().toISOString(),
                attempt: 1,
                status: "success",
                reasoningSnippet: "Auto-quoted unquoted special characters/parentheses in node labels.",
              };
              setDebugTrace(trace);
              setCurrentCode(quickSanitized);
              setSvgHtml(normalizeMermaidSvg(svg));
              setStatus("rendered");
              setErrorMessage("");

              if (onCodeRepaired) {
                onCodeRepaired(codeToRender, quickSanitized);
              }

              if (messageId && fullReport) {
                const updatedReport = fullReport.replace(codeToRender, quickSanitized);
                fetch(`/api/threads/${threadId || "current"}/messages/${messageId}/report`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ report: updatedReport }),
                }).catch(console.warn);
              }
              return;
            }
          } catch {
            // Heuristic alone wasn't enough; proceed to LLM repair
          }
        }

        // 2. Trigger Server LLM Self-Healing
        if (!isHealingRef.current && attemptsRef.current < MAX_ATTEMPTS) {
          healDiagram(codeToRender, errText);
        } else {
          setErrorMessage(errText);
          setStatus("error");
        }
      }
    }

    async function healDiagram(brokenSnippet: string, errorDetail: string) {
      if (attemptsRef.current >= MAX_ATTEMPTS) {
        console.warn(`[MermaidDiagram] ⚠️ Max repair attempts (${MAX_ATTEMPTS}) reached. Halting self-heal loop.`);
        setErrorMessage(errorDetail);
        setStatus("error");
        return;
      }

      attemptsRef.current += 1;
      const currentAttempt = attemptsRef.current;
      isHealingRef.current = true;
      setStatus("healing");

      const startTime = Date.now();
      console.log(`[MermaidDiagram] 🔧 Starting self-heal attempt ${currentAttempt}/${MAX_ATTEMPTS}...`);

      try {
        const payload: any = {
          brokenCode: brokenSnippet,
          errorMessage: errorDetail,
          messageId,
          threadId,
        };

        const res = await fetch("/api/diagram/fix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          throw new Error(`Self-healing server responded with status ${res.status}`);
        }

        const data = await res.json();
        let repairedCode: string = data.fixedCode;

        if (!repairedCode || repairedCode.trim() === brokenSnippet.trim()) {
          throw new Error("Repair engine returned identical or empty code.");
        }

        repairedCode = sanitizeMermaidSyntax(repairedCode);

        // Test repaired code with mermaid.parse
        const mermaid = (window as any).mermaid;
        await mermaid.parse(repairedCode);

        // Render SVG with repaired code
        const uniqueId = "mermaid-fixed-" + Math.random().toString(36).substring(2, 9);
        const { svg } = await mermaid.render(uniqueId, repairedCode);

        if (!isCancelled) {
          const duration = data.debug?.durationMs || Date.now() - startTime;
          const healId = data.debug?.healId || Math.random().toString(36).substring(2, 8);
          const model = data.debug?.modelUsed || "ollama:deepseek-r1:1.5b";
          const strategy = data.debug?.strategy || "llm-repair";

          const trace: SelfHealTrace = {
            healId,
            modelUsed: model,
            strategy,
            durationMs: duration,
            originalError: errorDetail,
            originalCode: brokenSnippet,
            repairedCode,
            timestamp: data.debug?.timestamp || new Date().toISOString(),
            attempt: currentAttempt,
            status: "success",
            reasoningSnippet: data.debug?.reasoningSnippet,
          };
          setDebugTrace(trace);

          console.groupCollapsed(
            `%c⚡ [Self-Heal #${healId}] Mermaid Diagram Repaired (%c${model}%c · ${duration}ms)`,
            "color: #38bdf8; font-weight: bold; background: #0f172a; padding: 2px 6px; border-radius: 4px;",
            "color: #fbbf24; font-weight: bold;",
            "color: #38bdf8;"
          );
          console.log("Heal ID:", healId);
          console.log("Model Engine:", model);
          console.log("Repair Strategy:", strategy);
          console.log("Latency:", `${duration}ms`);
          console.log("Syntax Error Fixed:", errorDetail);
          if (trace.reasoningSnippet) {
            console.log("LLM Reasoning:\n" + trace.reasoningSnippet);
          }
          console.log("Original Broken Code:\n" + brokenSnippet);
          console.log("Repaired Code:\n" + repairedCode);
          console.groupEnd();

          setCurrentCode(repairedCode);
          setSvgHtml(normalizeMermaidSvg(svg));
          setStatus("rendered");
          setErrorMessage("");

          if (onCodeRepaired) {
            onCodeRepaired(brokenSnippet, repairedCode);
          }

          if (messageId && fullReport) {
            const updatedReport = fullReport.replace(brokenSnippet, repairedCode);
            fetch(`/api/threads/${threadId || "current"}/messages/${messageId}/report`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ report: updatedReport }),
            }).catch((err) => console.warn("[MermaidDiagram] Failed to save updated report:", err));
          }
        }
      } catch (healError: any) {
        const errorDetailMsg = healError?.message || String(healError);
        console.error(`[MermaidDiagram] ❌ Self-heal attempt ${currentAttempt}/${MAX_ATTEMPTS} failed:`, healError);
        if (!isCancelled) {
          const failedTrace: SelfHealTrace = {
            healId: Math.random().toString(36).substring(2, 8),
            modelUsed: "local/cloud-engine",
            durationMs: Date.now() - startTime,
            originalError: errorDetail,
            originalCode: brokenSnippet,
            repairedCode: "",
            timestamp: new Date().toISOString(),
            attempt: currentAttempt,
            status: "failed",
          };
          setDebugTrace(failedTrace);
          setErrorMessage(errorDetailMsg);
          setStatus("error");
        }
      } finally {
        isHealingRef.current = false;
      }
    }

    renderDiagram(currentCode);

    return () => {
      isCancelled = true;
    };
  }, [currentCode, retryCount]);

  // Calculate boundary limits to ensure the diagram cannot be dragged into empty space
  const getPanBounds = useCallback(() => {
    if (!viewportRef.current || !canvasLayerRef.current) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0, canPanX: false, canPanY: false };
    }
    const viewportW = viewportRef.current.clientWidth;
    const viewportH = viewportRef.current.clientHeight;

    const svgEl = canvasLayerRef.current.querySelector("svg");
    let contentW = 0;
    let contentH = 0;
    if (svgEl) {
      const rect = svgEl.getBoundingClientRect();
      contentW = rect.width;
      contentH = rect.height;
    }
    if (!contentW && canvasLayerRef.current) {
      contentW = (canvasLayerRef.current.offsetWidth || 0) * zoom;
      contentH = (canvasLayerRef.current.offsetHeight || 0) * zoom;
    }

    const overflowX = contentW - viewportW;
    const overflowY = contentH - viewportH;

    // Buffer to avoid 1-2px jitter from rounding
    const canPanX = overflowX > 6;
    const canPanY = overflowY > 6;

    const minX = canPanX ? -overflowX / 2 : 0;
    const maxX = canPanX ? overflowX / 2 : 0;
    const minY = canPanY ? -overflowY / 2 : 0;
    const maxY = canPanY ? overflowY / 2 : 0;

    return { minX, maxX, minY, maxY, canPanX, canPanY };
  }, [zoom]);

  // Re-clamp pan and update pannable state when zoom, content, window dimensions, or fullscreen state change
  useEffect(() => {
    const updateBoundsAndClamp = () => {
      const { minX, maxX, minY, maxY, canPanX, canPanY } = getPanBounds();
      setIsPannable(canPanX || canPanY);
      setPan((prev) => {
        const clampedX = Math.max(minX, Math.min(maxX, prev.x));
        const clampedY = Math.max(minY, Math.min(maxY, prev.y));
        if (clampedX === prev.x && clampedY === prev.y) return prev;
        return { x: clampedX, y: clampedY };
      });
    };

    updateBoundsAndClamp();

    const t1 = setTimeout(updateBoundsAndClamp, 60);
    const t2 = setTimeout(updateBoundsAndClamp, 250);
    window.addEventListener("resize", updateBoundsAndClamp);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", updateBoundsAndClamp);
    };
  }, [zoom, svgHtml, status, getPanBounds, isFullscreen]);

  // Pointer / Drag-to-Pan Handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only capture pointer for mouse/pen drag so touch gestures can scroll naturally
    if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a")) return;

    // If diagram fits completely in the viewport without overflow, do not allow moving
    const { canPanX, canPanY } = getPanBounds();
    if (!canPanX && !canPanY) return;

    // If user clicked in the empty space beside the diagram, do not allow moving
    if (!(e.target as HTMLElement).closest(".mermaid-canvas-layer")) {
      return;
    }

    setIsPanning(true);
    startPanRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialPanX: pan.x,
      initialPanY: pan.y,
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanning) return;
    const deltaX = e.clientX - startPanRef.current.startX;
    const deltaY = e.clientY - startPanRef.current.startY;
    const targetX = startPanRef.current.initialPanX + deltaX;
    const targetY = startPanRef.current.initialPanY + deltaY;

    // Strictly clamp pan to diagram boundaries - never reveal empty space beside it
    const { minX, maxX, minY, maxY } = getPanBounds();
    const clampedX = Math.max(minX, Math.min(maxX, targetX));
    const clampedY = Math.max(minY, Math.min(maxY, targetY));

    setPan({
      x: clampedX,
      y: clampedY,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanning) {
      setIsPanning(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const handleResetView = () => {
    setPan({ x: 0, y: 0 });
    setZoom(1.0);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyDebug = () => {
    if (!debugTrace) return;
    navigator.clipboard.writeText(JSON.stringify(debugTrace, null, 2));
    setCopiedDebug(true);
    setTimeout(() => setCopiedDebug(false), 2000);
  };

  const handleManualRetry = () => {
    attemptsRef.current = 0;
    isHealingRef.current = false;
    setErrorMessage("");
    setStatus("validating");
    setRetryCount((prev) => prev + 1);
  };

  // Full Screen Mode Handlers & Listeners
  const toggleFullscreen = useCallback(async () => {
    const cardEl = cardRef.current;
    if (!cardEl) return;

    if (!isFullscreen) {
      setIsFullscreen(true);
      try {
        if (cardEl.requestFullscreen) {
          await cardEl.requestFullscreen();
        } else if ((cardEl as any).webkitRequestFullscreen) {
          await (cardEl as any).webkitRequestFullscreen();
        }
      } catch (err) {
        // Fallback gracefully to CSS fixed fullscreen overlay
        console.warn("[MermaidDiagram] Browser native fullscreen blocked, using overlay:", err);
      }
    } else {
      if (document.fullscreenElement) {
        try {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if ((document as any).webkitExitFullscreen) {
            await (document as any).webkitExitFullscreen();
          }
        } catch (err) {
          console.warn("[MermaidDiagram] Exit browser fullscreen failed:", err);
        }
      }
      setIsFullscreen(false);
    }
  }, [isFullscreen]);

  // Synchronize state if user exits browser native fullscreen via Escape or browser UI
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCardFullscreen = !!(
        document.fullscreenElement &&
        cardRef.current &&
        (document.fullscreenElement === cardRef.current || cardRef.current.contains(document.fullscreenElement))
      );
      if (!isCardFullscreen && !document.fullscreenElement && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, [isFullscreen]);

  // Exit fullscreen on Escape key even when using CSS fixed overlay fallback
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        if (document.fullscreenElement) {
          try {
            document.exitFullscreen().catch(() => {});
          } catch {}
        }
        setIsFullscreen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFullscreen]);

  // Lock body scroll while in full screen mode
  useEffect(() => {
    if (isFullscreen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [isFullscreen]);

  return (
    <div
      ref={cardRef}
      className={`mermaid-diagram-card ${isFullscreen ? "is-fullscreen" : ""}`}
    >
      {/* Top Header / Bar */}
      <div className="mermaid-card-header">
        <div className="mermaid-header-left">
          <div className="mermaid-tab-group">
            <button
              className={`mermaid-tab-btn ${activeTab === "preview" ? "active" : ""}`}
              onClick={() => setActiveTab("preview")}
            >
              Preview
            </button>
            <button
              className={`mermaid-tab-btn ${activeTab === "code" ? "active" : ""}`}
              onClick={() => setActiveTab("code")}
            >
              Code
            </button>
          </div>

          {/* Self-Healing Tracking Badge */}
          {debugTrace && (
            <button
              type="button"
              className={`mermaid-debug-trigger-badge ${debugTrace.status === "success" ? "success" : "failed"}`}
              onClick={() => setShowDebugDrawer(!showDebugDrawer)}
              title="Toggle self-healing debug trace & telemetry"
            >
              <span className="debug-badge-icon">
                {debugTrace.status === "success" ? "⚡" : "⚠️"}
              </span>
              <span className="debug-badge-title">
                {debugTrace.status === "success" ? "Self-Healed" : "Heal Failed"}
              </span>
              <span className="debug-badge-meta">
                {debugTrace.modelUsed.split(":").pop()} · {debugTrace.durationMs}ms
              </span>
              <span className="debug-badge-arrow">{showDebugDrawer ? "▲" : "▼"}</span>
            </button>
          )}
        </div>

        <div className="mermaid-header-right">
          {/* Zoom / Scale & Pan Reset Controls */}
          {status === "rendered" && activeTab === "preview" && (
            <>
              <div className="mermaid-zoom-controls">
                <button
                  type="button"
                  className="mermaid-zoom-btn"
                  title="Zoom Out"
                  onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.15) * 100) / 100))}
                >
                  −
                </button>
                <span
                  className="mermaid-zoom-val"
                  title="Click to reset zoom to 100%"
                  onClick={() => setZoom(1.0)}
                >
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  className="mermaid-zoom-btn"
                  title="Zoom In"
                  onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.15) * 100) / 100))}
                >
                  +
                </button>
              </div>

              {(pan.x !== 0 || pan.y !== 0 || zoom !== 1.0) && (
                <button
                  type="button"
                  className="mermaid-action-btn reset-view-btn"
                  title="Reset Pan & Zoom View to Center"
                  onClick={handleResetView}
                >
                  ↺ Reset View
                </button>
              )}
            </>
          )}

          {debugTrace && showDebugDrawer && (
            <button
              className="mermaid-action-btn"
              title="Copy Self-Heal Telemetry JSON"
              onClick={handleCopyDebug}
            >
              {copiedDebug ? (
                <span style={{ color: "var(--accent)" }}>✓ Copied Trace</span>
              ) : (
                <span>Copy Trace JSON</span>
              )}
            </button>
          )}

          {/* Full Screen Mode Toggle Button */}
          <button
            type="button"
            className={`mermaid-action-btn mermaid-fullscreen-btn ${isFullscreen ? "active" : ""}`}
            title={isFullscreen ? "Exit Full Screen (Esc)" : "Full Screen Mode (Esc to exit)"}
            onClick={toggleFullscreen}
          >
            {isFullscreen ? (
              <>
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="10" y1="14" x2="3" y2="21" />
                </svg>
                <span>Exit Full Screen</span>
              </>
            ) : (
              <>
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
                <span>Full Screen</span>
              </>
            )}
          </button>

          <button
            className="mermaid-action-btn"
            title="Copy Mermaid Code"
            onClick={handleCopyCode}
          >
            {copied ? (
              <span style={{ color: "var(--accent)" }}>✓ Copied</span>
            ) : (
              <span>Copy Code</span>
            )}
          </button>
        </div>
      </div>

      {/* Expandable Debug Drawer / Inspector */}
      {showDebugDrawer && debugTrace && (
        <div className="mermaid-debug-drawer">
          <div className="debug-drawer-header">
            <div className="debug-drawer-title-group">
              <span className="debug-drawer-icon">🛠️</span>
              <span className="debug-drawer-title">Self-Healing Diagnostic Trace</span>
              <span className="debug-drawer-id">#{debugTrace.healId}</span>
            </div>
            <div className="debug-drawer-status-pill">
              {debugTrace.status === "success" ? (
                <span className="status-success">✓ Repaired & Validated</span>
              ) : (
                <span className="status-failed">❌ Repair Failed</span>
              )}
            </div>
          </div>

          {/* Telemetry Chips Bar */}
          <div className="debug-telemetry-grid">
            <div className="debug-metric-card">
              <span className="metric-label">Engine</span>
              <span className="metric-val model">{debugTrace.modelUsed}</span>
            </div>
            <div className="debug-metric-card">
              <span className="metric-label">Strategy</span>
              <span className="metric-val">{debugTrace.strategy || "auto"}</span>
            </div>
            <div className="debug-metric-card">
              <span className="metric-label">Latency</span>
              <span className="metric-val">{debugTrace.durationMs}ms</span>
            </div>
            <div className="debug-metric-card">
              <span className="metric-label">Attempt</span>
              <span className="metric-val">{debugTrace.attempt} / {MAX_ATTEMPTS}</span>
            </div>
          </div>

          {/* Original Syntax Error */}
          <div className="debug-section">
            <div className="debug-section-label">
              <span className="error-dot">●</span> Parser Error Detected
            </div>
            <div className="debug-error-box">
              <code>{debugTrace.originalError}</code>
            </div>
          </div>

          {/* Model Reasoning / Thought Trace */}
          {debugTrace.reasoningSnippet && (
            <div className="debug-section">
              <div className="debug-section-label">
                <span className="reasoning-dot">✦</span> Repair Reasoning & Diagnostics
              </div>
              <div className="debug-reasoning-box">
                <pre>{debugTrace.reasoningSnippet}</pre>
              </div>
            </div>
          )}

          {/* Side-by-side or Stacked Diff */}
          <div className="debug-section">
            <div className="debug-section-label">
              <span>⇄</span> Syntax Fix Comparison
            </div>
            <div className="debug-diff-grid">
              <div className="diff-card broken">
                <div className="diff-header broken">Original (Broken Syntax)</div>
                <pre>
                  <code>{debugTrace.originalCode}</code>
                </pre>
              </div>
              <div className="diff-card repaired">
                <div className="diff-header repaired">Repaired (Valid Mermaid)</div>
                <pre>
                  <code>{debugTrace.repairedCode || "(No valid fix generated)"}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Body */}
      <div className="mermaid-card-body" ref={containerRef}>
        {/* State 1: Validating Loader */}
        {status === "validating" && activeTab === "preview" && (
          <div className="mermaid-status-box validating">
            <div className="spinner"></div>
            <span>Validating Mermaid syntax & rendering preview...</span>
          </div>
        )}

        {/* State 2: Self-Healing Loader */}
        {status === "healing" && activeTab === "preview" && (
          <div className="mermaid-status-box healing">
            <div className="spinner-healing"></div>
            <div className="healing-text-group">
              <div className="healing-title-row">
                <span className="healing-title">⚠️ Syntax Error Detected in Diagram</span>
                <span className="healing-attempt-pill">
                  Attempt {attemptsRef.current} of {MAX_ATTEMPTS}
                </span>
              </div>
              <span className="healing-subtitle">
                Self-healing syntax via intelligent local/cloud repair engine...
              </span>
            </div>
          </div>
        )}

        {/* State 3: Interactive Drag-to-Pan Canvas Preview */}
        {status === "rendered" && activeTab === "preview" && (
          <div
            ref={viewportRef}
            className={`mermaid-viewport ${isPannable ? "pannable" : ""} ${isPanning ? "panning" : ""}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {/* Quick floating Full Screen icon button inside diagram canvas */}
            <button
              type="button"
              className={`mermaid-viewport-fullscreen-btn ${isFullscreen ? "active" : ""}`}
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit Full Screen (Esc)" : "Full Screen Diagram"}
              aria-label={isFullscreen ? "Exit Full Screen" : "Full Screen Diagram"}
            >
              {isFullscreen ? (
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
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="10" y1="14" x2="3" y2="21" />
                </svg>
              ) : (
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
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </button>

            <div
              ref={canvasLayerRef}
              className="mermaid-canvas-layer"
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                transformOrigin: "center center",
                transition: isPanning ? "none" : "transform 0.12s ease-out",
              }}
              dangerouslySetInnerHTML={{ __html: svgHtml }}
            />
            <div className="mermaid-drag-hint">
              {isFullscreen ? (
                isPannable ? (
                  <span>✋ Drag to pan · Esc to exit</span>
                ) : (
                  <span>🔍 Esc to exit full screen</span>
                )
              ) : isPannable ? (
                <span>✋ Drag diagram to pan</span>
              ) : (
                <span>🔍 Diagram fits view</span>
              )}
            </div>
          </div>
        )}

        {/* State 4: Error Fallback */}
        {status === "error" && activeTab === "preview" && (
          <div className="mermaid-status-box error">
            <div className="error-title">Diagram Syntax Issue</div>
            <div className="error-detail">{errorMessage || "Invalid Mermaid syntax."}</div>
            <div className="error-actions">
              <button className="btn-secondary" onClick={() => setActiveTab("code")}>
                Inspect Code
              </button>
              {debugTrace && (
                <button
                  className="btn-secondary"
                  onClick={() => setShowDebugDrawer(true)}
                >
                  View Debug Trace
                </button>
              )}
              <button className="btn-primary" onClick={handleManualRetry}>
                Retry Auto-Fix
              </button>
            </div>
          </div>
        )}

        {/* Code Tab View */}
        {activeTab === "code" && (
          <div className="mermaid-code-view">
            <pre>
              <code>{currentCode}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
});
