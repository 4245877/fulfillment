import React, { useState } from "react";
import styles from "../Settings.module.css";

export function Card({ title, sub, children, right }) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderText}>
          <h2 className={styles.cardTitle}>{title}</h2>
          {sub ? <div className={styles.cardSubtitle}>{sub}</div> : null}
        </div>

        {right ? <div className={styles.cardActions}>{right}</div> : null}
      </div>

      <div className={styles.cardBody}>{children}</div>
    </section>
  );
}

export function FieldRow({ label, hint, children }) {
  return (
    <div className={styles.fieldRow}>
      <div className={styles.fieldLabel}>
        <div className={styles.fieldLabelText}>{label}</div>
        {hint ? <div className={styles.fieldHint}>{hint}</div> : null}
      </div>

      <div className={styles.fieldInput}>{children}</div>
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
    <div className={styles.inputGroup}>
      <div className={styles.chipsContainer}>
        {items.map((x, i) => (
          <span key={`${x}-${i}`} className={styles.chip}>
            <span>{x}</span>

            <button
              className={styles.chipRemove}
              type="button"
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              aria-label={`Удалить ${x}`}
            >
              ×
            </button>
          </span>
        ))}

        {!items.length ? <span className={styles.chipEmpty}>—</span> : null}
      </div>

      <input
        className="input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;

          e.preventDefault();

          const v = draft.trim();

          if (!v) return;

          if (!items.includes(v)) onChange([...items, v]);

          setDraft("");
        }}
      />
    </div>
  );
}

export function DangerZone({ title, children }) {
  return (
    <div className={styles.dangerZone}>
      <div className={styles.dangerTitle}>{title}</div>
      <div className={styles.dangerContent}>{children}</div>
    </div>
  );
}