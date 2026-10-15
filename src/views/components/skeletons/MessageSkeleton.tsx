import React from "react";

export const MessageSkeleton: React.FC = () => {
  return (
    <div className="message-skeleton-container" aria-busy="true" aria-label="Loading conversation messages">
      {/* User Prompt Skeleton */}
      <div className="skeleton-user-message">
        <div className="skeleton-box" style={{ width: "220px", height: "16px" }} />
      </div>

      {/* Assistant Card Skeleton */}
      <div className="skeleton-assistant-message">
        {/* Stepper Header Skeleton */}
        <div className="skeleton-stepper-header">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div className="skeleton-box" style={{ width: "16px", height: "16px", borderRadius: "50%" }} />
            <div className="skeleton-box" style={{ width: "170px", height: "14px" }} />
          </div>
          <div className="skeleton-box" style={{ width: "70px", height: "20px", borderRadius: "10px" }} />
        </div>

        {/* Stepper Rounds Tray Skeleton */}
        <div className="skeleton-rounds-tray">
          <div className="skeleton-box" style={{ width: "130px", height: "22px", borderRadius: "12px" }} />
          <div className="skeleton-box" style={{ width: "180px", height: "22px", borderRadius: "12px" }} />
          <div className="skeleton-box" style={{ width: "110px", height: "22px", borderRadius: "12px" }} />
        </div>

        {/* Reasoning / Thinking Box Skeleton */}
        <div className="skeleton-think-box">
          <div className="skeleton-box" style={{ width: "190px", height: "13px", marginBottom: "8px" }} />
          <div className="skeleton-box" style={{ width: "100%", height: "12px", marginBottom: "6px" }} />
          <div className="skeleton-box" style={{ width: "88%", height: "12px" }} />
        </div>

        {/* Report Content Lines Skeleton */}
        <div className="skeleton-report-body">
          <div className="skeleton-box" style={{ width: "55%", height: "22px", marginBottom: "14px" }} />
          <div className="skeleton-box" style={{ width: "100%", height: "14px", marginBottom: "8px" }} />
          <div className="skeleton-box" style={{ width: "95%", height: "14px", marginBottom: "8px" }} />
          <div className="skeleton-box" style={{ width: "98%", height: "14px", marginBottom: "8px" }} />
          <div className="skeleton-box" style={{ width: "65%", height: "14px", marginBottom: "18px" }} />

          <div className="skeleton-box" style={{ width: "40%", height: "18px", marginBottom: "12px" }} />
          <div className="skeleton-box" style={{ width: "100%", height: "14px", marginBottom: "8px" }} />
          <div className="skeleton-box" style={{ width: "85%", height: "14px" }} />
        </div>
      </div>
    </div>
  );
};
