import React from "react";

interface KbCardSkeletonProps {
  count?: number;
}

export const KbCardSkeleton: React.FC<KbCardSkeletonProps> = ({ count = 3 }) => {
  return (
    <div className="skeleton-list" aria-busy="true" aria-label="Loading knowledge base">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="skeleton-kb-card">
          <div className="skeleton-kb-header">
            <div className="skeleton-box" style={{ width: "70px", height: "18px", borderRadius: "10px" }} />
            <div className="skeleton-box" style={{ width: "90px", height: "12px" }} />
          </div>
          <div className="skeleton-box" style={{ width: "80%", height: "16px", margin: "10px 0 8px 0" }} />
          <div className="skeleton-box" style={{ width: "100%", height: "12px", marginBottom: "5px" }} />
          <div className="skeleton-box" style={{ width: "92%", height: "12px", marginBottom: "10px" }} />
          <div className="skeleton-kb-tags">
            <div className="skeleton-box" style={{ width: "50px", height: "18px", borderRadius: "8px" }} />
            <div className="skeleton-box" style={{ width: "65px", height: "18px", borderRadius: "8px" }} />
            <div className="skeleton-box" style={{ width: "55px", height: "18px", borderRadius: "8px" }} />
          </div>
        </div>
      ))}
    </div>
  );
};
