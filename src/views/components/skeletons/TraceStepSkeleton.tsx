import React from "react";

interface TraceStepSkeletonProps {
  count?: number;
}

export const TraceStepSkeleton: React.FC<TraceStepSkeletonProps> = ({ count = 4 }) => {
  return (
    <div className="skeleton-list" aria-busy="true" aria-label="Loading graph telemetry traces">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="skeleton-trace-item">
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <div className="skeleton-box" style={{ width: "8px", height: "8px", borderRadius: "50%" }} />
            <div className="skeleton-box" style={{ width: "95px", height: "18px", borderRadius: "6px" }} />
            <div className="skeleton-box" style={{ width: "55px", height: "12px", marginLeft: "auto" }} />
          </div>
          <div className="skeleton-box" style={{ width: "80%", height: "12px", marginLeft: "16px" }} />
        </div>
      ))}
    </div>
  );
};
