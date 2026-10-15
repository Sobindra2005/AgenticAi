import React from "react";

interface ThreadCardSkeletonProps {
  count?: number;
}

export const ThreadCardSkeleton: React.FC<ThreadCardSkeletonProps> = ({ count = 4 }) => {
  return (
    <div className="skeleton-threads-grid" aria-busy="true" aria-label="Loading thread cards">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="skeleton-thread-card">
          <div className="skeleton-thread-header">
            <div className="skeleton-box" style={{ width: "65%", height: "18px", marginBottom: "8px" }} />
            <div style={{ display: "flex", gap: "6px" }}>
              <div className="skeleton-box" style={{ width: "50px", height: "12px" }} />
              <div className="skeleton-box" style={{ width: "40px", height: "12px" }} />
            </div>
          </div>
          <div className="skeleton-box" style={{ width: "95%", height: "13px", margin: "14px 0 6px 0" }} />
          <div className="skeleton-box" style={{ width: "75%", height: "13px", marginBottom: "16px" }} />
          <div className="skeleton-thread-footer">
            <div className="skeleton-box" style={{ width: "60px", height: "18px", borderRadius: "10px" }} />
            <div className="skeleton-box" style={{ width: "60px", height: "18px", borderRadius: "10px" }} />
            <div className="skeleton-box" style={{ width: "60px", height: "18px", borderRadius: "10px" }} />
          </div>
        </div>
      ))}
    </div>
  );
};
