import React, { useState } from "react";
import styles from "../Settings.module.css";

export function Card({ title, sub, children, right }) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{title}</div>
          {sub ? (
            <div className="muted" style={{ fontSize: 12 }}>
              {sub}
            </div>
          ) : null}
        </div>
        {right ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{right}</div> : null}
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}

export function FieldRow({ label, hint, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12, padding: "10px 0" }}>
      <div>
        <div style={{ fontWeight: 650 }}>{label}</div>
        {hint ? (
          <div className="muted" style={{ fontSize: 12 }}>
            {hint}
          </div>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function Toggle({ value, onChange, label }) {
  return (
    <label className={styles.toggle}>
      <input
        className={styles.toggleInput}
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.toggleLabel}>{label}</span>
    </label>
  );
}

export function NumberInput({ value, onChange, min, max, step }) {
  return (
    <input
      className="input"
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
    />
  );
}

export function TextInput({ value, onChange, placeholder }) {
  return (
    <input
      className="input"
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Select({ value, onChange, options }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function TextArea({ value, onChange, placeholder, rows = 3, onBlur, onKeyDown }) {
  return (
    <textarea
      className="textarea"
      rows={rows}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  );
}

export function ChipsEditor({ value, onChange, placeholder = "Введи та натисни Enter" }) {
  const [draft, setDraft] = useState("");
  const items = Array.isArray(value) ? value : [];

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {items.map((x, i) => (
          <span key={`${x}-${i}`} className="tag" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {x}
            <button
              type="button"
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              style={{ padding: "2px 8px" }}
              aria-label="remove"
            >
              ×
            </button>
          </span>
        ))}
        {!items.length ? <span className="muted">—</span> : null}
      </div>

      <input
        className="input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const v = draft.trim();
            if (!v) return;
            if (!items.includes(v)) onChange([...items, v]);
            setDraft("");
          }
        }}
      />
    </div>
  );
}

export function DangerZone({ title, children }) {
  return (
    <div
      style={{
        border: "1px solid var(--danger-border)",
        borderRadius: 12,
        padding: 12,
        background: "color-mix(in srgb, var(--secondary) 6%, var(--surface))",
      }}
    >
      <div style={{ fontWeight: 800, color: "var(--danger-text)", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}