import React from "react";

interface SourceCardSkeletonProps {
  count?: number;
}

export const SourceCardSkeleton: React.FC<SourceCardSkeletonProps> = ({ count = 3 }) => {
  return (
    <div className="skeleton-list" aria-busy="true" aria-label="Loading sources">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="skeleton-source-card">
          <div className="skeleton-source-header">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div className="skeleton-box" style={{ width: "15px", height: "15px", borderRadius: "3px" }} />
              <div className="skeleton-box" style={{ width: "110px", height: "14px", borderRadius: "4px" }} />
            </div>
            <div className="skeleton-box" style={{ width: "55px", height: "18px", borderRadius: "9999px" }} />
          </div>
          <div className="skeleton-box" style={{ width: "85%", height: "14px", margin: "10px 0 6px 0" }} />
          <div className="skeleton-box" style={{ width: "100%", height: "12px", marginBottom: "4px" }} />
          <div className="skeleton-box" style={{ width: "70%", height: "12px" }} />
        </div>
      ))}
    </div>
  );
};
