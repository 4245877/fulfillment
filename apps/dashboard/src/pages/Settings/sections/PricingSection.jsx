// apps/dashboard/src/pages/settings/sections/PricingSection.jsx
import React from "react";
import { api } from "../../../api/client.js";
import { Card, FieldRow } from "../ui.jsx";
import styles from "../../Settings.module.css";

// ---------------------------------------------------------------------------
// Immutable tree helpers (array paths — safe for keys that contain dots, e.g.
// options.nozzle_mm."0.2").
// ---------------------------------------------------------------------------
function cloneContainer(value) {
  return Array.isArray(value) ? value.slice() : { ...value };
}

function setAt(obj, path, value) {
  if (path.length === 0) return value;

  const [head, ...rest] = path;
  const copy = cloneContainer(obj);

  copy[head] = rest.length === 0 ? value : setAt(obj[head], rest, value);

  return copy;
}

function deleteAt(obj, path) {
  const [head, ...rest] = path;
  const copy = cloneContainer(obj);

  if (rest.length === 0) {
    delete copy[head];
  } else {
    copy[head] = deleteAt(obj[head], rest);
  }

  return copy;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numToStr(value) {
  return Number.isFinite(value) ? String(value) : "";
}

// ---------------------------------------------------------------------------
// Field editors
// ---------------------------------------------------------------------------
function NumberField({ value, onChange, disabled }) {
  const [draft, setDraft] = React.useState(() => numToStr(value));
  const [focused, setFocused] = React.useState(false);

  // Keep the input in sync with external changes, but never fight the user while
  // they are typing (e.g. mid-way through "0.").
  React.useEffect(() => {
    if (!focused) setDraft(numToStr(value));
  }, [value, focused]);

  return (
    <input
      className="input"
      type="text"
      inputMode="decimal"
      value={draft}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setDraft(numToStr(value));
      }}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);

        const parsed = Number(next);

        if (next.trim() !== "" && Number.isFinite(parsed)) {
          onChange(parsed);
        }
      }}
    />
  );
}

function JsonArrayField({ value, onChange, disabled }) {
  const [draft, setDraft] = React.useState(() => JSON.stringify(value));
  const [invalid, setInvalid] = React.useState(false);

  React.useEffect(() => {
    setDraft(JSON.stringify(value));
  }, [value]);

  return (
    <div className={styles.pricingControl}>
      <input
        className="input"
        value={draft}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);

          try {
            const parsed = JSON.parse(next);

            if (Array.isArray(parsed)) {
              onChange(parsed);
              setInvalid(false);
            } else {
              setInvalid(true);
            }
          } catch {
            setInvalid(true);
          }
        }}
      />
      {invalid ? (
        <span className={styles.pricingWarn}>Очікується JSON-масив</span>
      ) : null}
    </div>
  );
}

function ScalarField({ value, onChange, disabled }) {
  if (typeof value === "boolean") {
    return (
      <label className={styles.pricingBool}>
        <input
          type="checkbox"
          checked={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{value ? "так" : "ні"}</span>
      </label>
    );
  }

  if (typeof value === "number") {
    return <NumberField value={value} onChange={onChange} disabled={disabled} />;
  }

  return (
    <input
      className="input"
      type="text"
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

// ---------------------------------------------------------------------------
// "Add new value" control
// ---------------------------------------------------------------------------
const TYPE_OPTIONS = [
  { value: "string", label: "Текст" },
  { value: "number", label: "Число" },
  { value: "boolean", label: "Так / Ні" },
  { value: "group", label: "Група" },
];

function initialValueForType(type, rawValue) {
  if (type === "number") {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (type === "boolean") return rawValue === "true" || rawValue === true;
  if (type === "group") return {};

  return rawValue ?? "";
}

function AddFieldRow({ existingKeys, onAdd, disabled }) {
  const [open, setOpen] = React.useState(false);
  const [key, setKey] = React.useState("");
  const [type, setType] = React.useState("string");
  const [rawValue, setRawValue] = React.useState("");

  const reset = () => {
    setKey("");
    setType("string");
    setRawValue("");
    setOpen(false);
  };

  const trimmedKey = key.trim();
  const isDuplicate = existingKeys.includes(trimmedKey);
  const canAdd = trimmedKey !== "" && !isDuplicate;

  const submit = () => {
    if (!canAdd) return;

    onAdd(trimmedKey, initialValueForType(type, rawValue));
    reset();
  };

  if (!open) {
    return (
      <button
        type="button"
        className={styles.pricingAddBtn}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        + Додати поле
      </button>
    );
  }

  return (
    <div className={styles.pricingAddRow}>
      <input
        className="input"
        placeholder="ключ"
        value={key}
        disabled={disabled}
        onChange={(event) => setKey(event.target.value)}
      />

      <select
        className="select"
        value={type}
        disabled={disabled}
        onChange={(event) => setType(event.target.value)}
      >
        {TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {type === "group" ? (
        <span className={styles.pricingHintInline}>порожня група</span>
      ) : type === "boolean" ? (
        <select
          className="select"
          value={rawValue === "true" || rawValue === true ? "true" : "false"}
          disabled={disabled}
          onChange={(event) => setRawValue(event.target.value)}
        >
          <option value="false">ні</option>
          <option value="true">так</option>
        </select>
      ) : (
        <input
          className="input"
          placeholder="значення"
          inputMode={type === "number" ? "decimal" : undefined}
          value={rawValue}
          disabled={disabled}
          onChange={(event) => setRawValue(event.target.value)}
        />
      )}

      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={disabled || !canAdd}
        onClick={submit}
      >
        Додати
      </button>

      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={disabled}
        onClick={reset}
      >
        Скасувати
      </button>

      {isDuplicate ? (
        <span className={styles.pricingWarn}>Ключ уже існує</span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recursive node
// ---------------------------------------------------------------------------
function PricingNode({ nodeKey, value, path, onSet, onDelete, disabled }) {
  const removeButton = (
    <button
      type="button"
      className={styles.pricingDelete}
      disabled={disabled}
      title="Видалити значення"
      aria-label={`Видалити ${nodeKey}`}
      onClick={() => onDelete(path)}
    >
      ×
    </button>
  );

  if (isPlainObject(value)) {
    const keys = Object.keys(value);

    return (
      <div className={styles.pricingGroup}>
        <div className={styles.pricingGroupHeader}>
          <span className={styles.pricingGroupKey}>{nodeKey}</span>
          {removeButton}
        </div>

        <div className={styles.pricingGroupBody}>
          {keys.map((childKey) => (
            <PricingNode
              key={childKey}
              nodeKey={childKey}
              value={value[childKey]}
              path={[...path, childKey]}
              onSet={onSet}
              onDelete={onDelete}
              disabled={disabled}
            />
          ))}

          <AddFieldRow
            existingKeys={keys}
            disabled={disabled}
            onAdd={(childKey, childValue) =>
              onSet([...path, childKey], childValue)
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pricingRow}>
      <span className={styles.pricingKey}>{nodeKey}</span>

      {Array.isArray(value) ? (
        <JsonArrayField
          value={value}
          disabled={disabled}
          onChange={(next) => onSet(path, next)}
        />
      ) : (
        <div className={styles.pricingControl}>
          <ScalarField
            value={value}
            disabled={disabled}
            onChange={(next) => onSet(path, next)}
          />
        </div>
      )}

      {removeButton}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------
export default function PricingSection({ showToast }) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [tree, setTree] = React.useState(null);
  const [meta, setMeta] = React.useState({ path: "", hash: "", raw: "" });
  const [loadedJson, setLoadedJson] = React.useState("");
  const [showRaw, setShowRaw] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await api.get("/api/ops/pricing", { timeoutMs: 20000 });

      if (!result || result.ok === false) {
        throw new Error(result?.error || "Не вдалося завантажити pricing.yml");
      }

      setTree(result.tree);
      setMeta({ path: result.path, hash: result.hash, raw: result.raw });
      setLoadedJson(JSON.stringify(result.tree));
    } catch (caught) {
      setTree(null);
      setError(String(caught?.message || caught));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const dirty = tree != null && JSON.stringify(tree) !== loadedJson;

  const onSet = React.useCallback(
    (path, value) => setTree((current) => setAt(current, path, value)),
    []
  );

  const onDelete = React.useCallback(
    (path) => setTree((current) => deleteAt(current, path)),
    []
  );

  const save = async () => {
    if (!dirty || saving) return;

    const confirmed = window.confirm(
      `Зберегти зміни у файл pricing.yml на сервері?\n\n${meta.path}\n\n` +
        "Коментарі та форматування незмінених рядків будуть збережені."
    );

    if (!confirmed) return;

    setSaving(true);

    try {
      const result = await api.put(
        "/api/ops/pricing",
        { tree, baseHash: meta.hash },
        { timeoutMs: 25000 }
      );

      if (!result || result.ok === false) {
        throw new Error(result?.error || "Не вдалося зберегти pricing.yml");
      }

      setTree(result.tree);
      setMeta({ path: result.path, hash: result.hash, raw: result.raw });
      setLoadedJson(JSON.stringify(result.tree));
      showToast?.({ kind: "success", text: "Збережено у pricing.yml ✅" }, 2500);
    } catch (caught) {
      showToast?.(
        { kind: "error", text: `Помилка: ${String(caught?.message || caught)}` },
        4000
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Змінні ціноутворення (pricing.yml)"
      sub="Редагування, додавання та видалення значень із прямим збереженням у файл на сервері"
    >
      <FieldRow
        label="Файл"
        hint="Зберігається на 192.168.0.135 через захищене SSH-з'єднання бекенду."
      >
        <div className={styles.pricingMeta}>
          <code className={styles.pricingPath}>{meta.path || "—"}</code>

          <div className={styles.pricingToolbar}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={loading || saving}
              onClick={load}
            >
              Перезавантажити
            </button>

            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!dirty || saving || loading}
              onClick={save}
            >
              {saving ? "Збереження…" : "Зберегти у pricing.yml"}
            </button>

            {dirty ? (
              <span className={styles.pricingDirty}>Є незбережені зміни</span>
            ) : null}
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Змінні"
        hint="× — видалити значення; «Додати поле» — створити нове (текст, число, так/ні або вкладена група)."
      >
        {loading ? (
          <div className="text-muted">Завантаження…</div>
        ) : error ? (
          <div className={styles.pricingError}>{error}</div>
        ) : tree ? (
          <div className={styles.pricingTree}>
            {Object.keys(tree).map((key) => (
              <PricingNode
                key={key}
                nodeKey={key}
                value={tree[key]}
                path={[key]}
                onSet={onSet}
                onDelete={onDelete}
                disabled={saving}
              />
            ))}

            <AddFieldRow
              existingKeys={Object.keys(tree)}
              disabled={saving}
              onAdd={(key, value) => onSet([key], value)}
            />
          </div>
        ) : (
          <div className="text-muted">Немає даних.</div>
        )}
      </FieldRow>

      <FieldRow
        label="Перегляд YAML"
        hint="Поточний вміст файлу (тільки для читання)."
      >
        <div className={styles.inputGroup}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowRaw((value) => !value)}
          >
            {showRaw ? "Сховати YAML" : "Показати YAML"}
          </button>

          {showRaw ? (
            <pre className={styles.pricingRaw}>{meta.raw || "—"}</pre>
          ) : null}
        </div>
      </FieldRow>
    </Card>
  );
}
