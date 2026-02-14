// components/Widget.jsx
import React from "react"; // ← важно для твоей сборки

export default function Widget({ title, sub, children }) {
  return (
    <section className="widget">
      <div className="w-head">
        <h3>{title}</h3>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      <div className="w-body">{children}</div>
    </section>
  );
}
