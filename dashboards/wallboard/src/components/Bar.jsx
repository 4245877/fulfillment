// components/Bar.jsx
import React from "react";

export default function Bar({ v = 0 }) {
  const vv = Math.max(0, Math.min(100, Number(v) || 0));
  return (
    <div className="progress-bar">
      <div className="progress-bar-fill" style={{ width: `${vv}%` }} />
    </div>
  );
}
