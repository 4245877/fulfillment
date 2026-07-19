// apps/dashboard/src/pages/settings/sections/PricingSection.jsx
import React from "react";
import { api } from "../../../api/client.js";
import { Card, FieldRow } from "../ui.jsx";
import styles from "../../Settings.module.css";
import {
  collectErrors,
  deleteAt,
  enumOptionsFor,
  initialValueForType,
  isPlainObject,
  isUnsafeKey,
  parseNumberInput,
  remapFormatsForRename,
  renameKeyAt,
  resolveNumberDisplay,
  setAt,
  TYPE_OPTIONS,
} from "./pricingModel.js";

// ---------------------------------------------------------------------------
// Field editors
// ---------------------------------------------------------------------------
function NumberField({ value, format, onChange, disabled }) {
  const [draft, setDraft] = React.useState(() =>
    resolveNumberDisplay(value, format)
  );
  const [focused, setFocused] = React.useState(false);
  const [invalid, setInvalid] = React.useState(false);

  // Keep the input in sync with external changes, but never fight the user while
  // they are typing (e.g. mid-way through "0.").
  React.useEffect(() => {
    if (!focused) setDraft(resolveNumberDisplay(value, format));
  }, [value, format, focused]);

  return (
    <>
      <input
        className="input"
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setDraft(resolveNumberDisplay(value, format));
          setInvalid(false);
        }}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);

          if (next.trim() === "") {
            setInvalid(false);
            return;
          }

          const parsed = parseNumberInput(next);
          if (parsed.ok) {
            setInvalid(false);
            onChange(parsed.value);
          } else {
            setInvalid(true);
          }
        }}
      />
      {invalid ? (
        <span className={styles.pricingWarn}>Невірне число (напр. 6.5 або 6,5)</span>
      ) : null}
    </>
  );
}

function EnumField({ value, options, onChange, disabled }) {
  return (
    <select
      className="select"
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function JsonArrayField({ value, onChange, disabled }) {
  const [draft, setDraft] = React.useState(() => JSON.stringify(value));
  const [focused, setFocused] = React.useState(false);
  const [invalid, setInvalid] = React.useState(false);

  // Re-sync from the canonical value only while not focused — otherwise every
  // valid keystroke rewrote the draft (JSON.stringify), jumping the caret and
  // making spaces impossible to type (issue #4).
  React.useEffect(() => {
    if (!focused) setDraft(JSON.stringify(value));
  }, [value, focused]);

  return (
    <div className={styles.pricingControl}>
      <input
        className="input"
        value={draft}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setDraft(JSON.stringify(value));
          setInvalid(false);
        }}
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

function ScalarField({ nodeKey, value, onChange, disabled, error, format }) {
  const enumOptions = enumOptionsFor(nodeKey, value);

  let control;
  if (enumOptions) {
    control = (
      <EnumField
        value={value}
        options={enumOptions}
        onChange={onChange}
        disabled={disabled}
      />
    );
  } else if (typeof value === "boolean") {
    control = (
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
  } else if (typeof value === "number") {
    control = (
      <NumberField
        value={value}
        format={format}
        onChange={onChange}
        disabled={disabled}
      />
    );
  } else {
    control = (
      <input
        className="input"
        type="text"
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <>
      {control}
      {error ? <span className={styles.pricingWarn}>{error}</span> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Inline key label with rename-in-place
// ---------------------------------------------------------------------------
function KeyLabel({ value, className, siblingKeys, onRename, disabled }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);

  const trimmed = draft.trim();
  const isDuplicate = trimmed !== value && siblingKeys.includes(trimmed);
  const unsafe = isUnsafeKey(trimmed);
  const canSave = trimmed !== "" && trimmed !== value && !isDuplicate && !unsafe;

  const open = () => {
    setDraft(value);
    setEditing(true);
  };

  const commit = () => {
    if (canSave) onRename(trimmed);
    setEditing(false);
  };

  if (!editing) {
    return (
      <span className={`${styles.pricingKeyWrap} ${className}`}>
        <span>{value}</span>
        <button
          type="button"
          className={styles.pricingEdit}
          disabled={disabled}
          title="Перейменувати ключ"
          aria-label={`Перейменувати ${value}`}
          onClick={open}
        >
          ✎
        </button>
      </span>
    );
  }

  return (
    <span className={styles.pricingKeyEdit}>
      <input
        className="input"
        autoFocus
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setEditing(false);
        }}
      />
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={disabled || !canSave}
        onClick={commit}
      >
        ✓
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={disabled}
        onClick={() => setEditing(false)}
      >
        ×
      </button>
      {isDuplicate ? (
        <span className={styles.pricingWarn}>Ключ уже існує</span>
      ) : unsafe ? (
        <span className={styles.pricingWarn}>Недопустимий ключ</span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// "Add new value" control
// ---------------------------------------------------------------------------
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
  const unsafe = isUnsafeKey(trimmedKey);
  // A "Число" field must hold a real number — don't silently coerce "abc" to 0.
  const numberOk = type !== "number" || parseNumberInput(rawValue).ok;
  const numberInvalid =
    type === "number" && rawValue.trim() !== "" && !parseNumberInput(rawValue).ok;
  const canAdd = trimmedKey !== "" && !isDuplicate && !unsafe && numberOk;

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
      ) : type === "array" ? (
        <span className={styles.pricingHintInline}>
          порожній масив (заповніть після додавання)
        </span>
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
      ) : unsafe ? (
        <span className={styles.pricingWarn}>Недопустимий ключ</span>
      ) : numberInvalid ? (
        <span className={styles.pricingWarn}>
          Невірне число (напр. 6.5 або 6,5)
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recursive node
// ---------------------------------------------------------------------------
function PricingNode({
  nodeKey,
  value,
  path,
  siblingKeys,
  onSet,
  onDelete,
  onRename,
  getError,
  getFormat,
  disabled,
}) {
  const handleRemove = () => {
    const groupCount = isPlainObject(value) ? Object.keys(value).length : 0;
    const arrayCount = Array.isArray(value) ? value.length : 0;
    const childCount = groupCount || arrayCount;

    if (childCount > 0) {
      const confirmed = window.confirm(
        `Видалити «${nodeKey}» разом із ${childCount} вкладеними значеннями?\n\n` +
          "Не хвилюйтеся: дію можна скасувати кнопкою «Скасувати останню зміну»."
      );
      if (!confirmed) return;
    }

    onDelete(path);
  };

  const removeButton = (
    <button
      type="button"
      className={styles.pricingDelete}
      disabled={disabled}
      title="Видалити значення"
      aria-label={`Видалити ${nodeKey}`}
      onClick={handleRemove}
    >
      ×
    </button>
  );

  const keyLabel = (className) => (
    <KeyLabel
      value={nodeKey}
      className={className}
      siblingKeys={siblingKeys}
      disabled={disabled}
      onRename={(newKey) => onRename(path, newKey)}
    />
  );

  if (isPlainObject(value)) {
    const keys = Object.keys(value);

    return (
      <div className={styles.pricingGroup}>
        <div className={styles.pricingGroupHeader}>
          {keyLabel(styles.pricingGroupKey)}
          {removeButton}
        </div>

        <div className={styles.pricingGroupBody}>
          {keys.map((childKey) => (
            <PricingNode
              key={childKey}
              nodeKey={childKey}
              value={value[childKey]}
              path={[...path, childKey]}
              siblingKeys={keys}
              onSet={onSet}
              onDelete={onDelete}
              onRename={onRename}
              getError={getError}
              getFormat={getFormat}
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
      {keyLabel(styles.pricingKey)}

      {Array.isArray(value) ? (
        <JsonArrayField
          value={value}
          disabled={disabled}
          onChange={(next) => onSet(path, next)}
        />
      ) : (
        <div className={styles.pricingControl}>
          <ScalarField
            nodeKey={nodeKey}
            value={value}
            disabled={disabled}
            error={getError(path)}
            format={getFormat(path)}
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
  const [formats, setFormats] = React.useState({});
  const [loadedJson, setLoadedJson] = React.useState("");
  const [showRaw, setShowRaw] = React.useState(false);
  const [conflict, setConflict] = React.useState(null);
  // Non-null when the server file can be read but not safely written back
  // (YAML anchors/aliases/merge keys) — editing is disabled (issue #6).
  const [readOnlyReason, setReadOnlyReason] = React.useState(null);

  // Undo history (refs avoid re-render churn; the length state drives the button).
  const treeRef = React.useRef(tree);
  const historyRef = React.useRef([]);
  const [historyLen, setHistoryLen] = React.useState(0);

  React.useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  const resetHistory = React.useCallback(() => {
    historyRef.current = [];
    setHistoryLen(0);
  }, []);

  const pushHistory = React.useCallback(() => {
    historyRef.current.push(treeRef.current);
    setHistoryLen(historyRef.current.length);
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await api.get("/api/ops/pricing", { timeoutMs: 20000 });

      if (!result || result.ok === false) {
        throw new Error(
          result?.error || "Мені не вдалося завантажити pricing.yml. Спробуйте, будь ласка, ще раз."
        );
      }

      setTree(result.tree);
      setMeta({ path: result.path, hash: result.hash, raw: result.raw });
      setFormats(result.formats || {});
      setLoadedJson(JSON.stringify(result.tree));
      setConflict(null);
      setReadOnlyReason(result.readOnly ? result.readOnlyReason : null);
      resetHistory();
    } catch (caught) {
      setTree(null);
      setError(String(caught?.message || caught));
    } finally {
      setLoading(false);
    }
  }, [resetHistory]);

  React.useEffect(() => {
    load();
  }, [load]);

  const dirty = tree != null && JSON.stringify(tree) !== loadedJson;

  const errors = React.useMemo(() => {
    const out = {};
    if (tree) collectErrors(tree, [], out);
    return out;
  }, [tree]);

  const hasErrors = Object.keys(errors).length > 0;
  const getError = React.useCallback(
    (path) => errors[JSON.stringify(path)],
    [errors]
  );

  const getFormat = React.useCallback(
    (path) => formats[JSON.stringify(path)],
    [formats]
  );

  // A root with no keys can never be saved (the server refuses it) — catch it on
  // the client with a clear message instead of a raw 502 toast (issue #3).
  const isEmpty = tree != null && Object.keys(tree).length === 0;

  // A file using anchors/aliases can be inspected but not edited (issue #6).
  const readOnly = readOnlyReason != null;
  const editingDisabled = saving || readOnly;

  // Warn before leaving the tab/page with unsaved edits (issue #10).
  React.useEffect(() => {
    if (!dirty) return undefined;

    const handler = (event) => {
      event.preventDefault();
      event.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const onSet = React.useCallback(
    (path, value) => {
      pushHistory();
      setTree((current) => setAt(current, path, value));
    },
    [pushHistory]
  );

  const onDelete = React.useCallback(
    (path) => {
      pushHistory();
      setTree((current) => deleteAt(current, path));
    },
    [pushHistory]
  );

  const onRename = React.useCallback(
    (path, newKey) => {
      pushHistory();
      setTree((current) => renameKeyAt(current, path, newKey));
      // Move the trailing-zero formatting hints to the new path so "6.00" keeps
      // displaying as "6.00" immediately, not only after the next save (issue #3).
      setFormats((current) => remapFormatsForRename(current, path, newKey));
    },
    [pushHistory]
  );

  const undo = React.useCallback(() => {
    const previous = historyRef.current.pop();
    setHistoryLen(historyRef.current.length);
    if (previous !== undefined) setTree(previous);
  }, []);

  const reload = () => {
    if (
      dirty &&
      !window.confirm(
        "У вас є незбережені зміни, і перезавантаження їх відкине. Ви точно хочете продовжити?"
      )
    ) {
      return;
    }
    load();
  };

  const save = async (overrideHash) => {
    if (!dirty || saving || readOnly) return;

    if (isEmpty) {
      showToast?.(
        {
          kind: "error",
          text: "Ой… конфігурація не може бути зовсім порожньою. Залиште, будь ласка, хоча б один ключ.",
        },
        3500
      );
      return;
    }

    if (hasErrors) {
      showToast?.(
        {
          kind: "error",
          text: "Перед збереженням виправте, будь ласка, помилки валідації — я не хочу зіпсувати файл.",
        },
        3500
      );
      return;
    }

    const isOverwrite = overrideHash !== undefined;
    const confirmed = window.confirm(
      isOverwrite
        ? `Перезаписати версію на сервері вашими змінами?\n\n${meta.path}\n\nЦе замінить те, що зараз на сервері, — будьте, будь ласка, уважні.`
        : `Зберегти зміни у файл pricing.yml на сервері?\n\n${meta.path}\n\n` +
            "Коментарі та форматування незмінених рядків я дбайливо збережу."
    );

    if (!confirmed) return;

    setSaving(true);

    try {
      const result = await api.put(
        "/api/ops/pricing",
        { tree, baseHash: overrideHash ?? meta.hash },
        { timeoutMs: 25000 }
      );

      if (!result || result.ok === false) {
        throw new Error(
          result?.error || "Мені не вдалося зберегти pricing.yml. Ваші правки залишилися у формі."
        );
      }

      setTree(result.tree);
      setMeta({ path: result.path, hash: result.hash, raw: result.raw });
      setFormats(result.formats || {});
      setLoadedJson(JSON.stringify(result.tree));
      setConflict(null);
      setReadOnlyReason(result.readOnly ? result.readOnlyReason : null);
      resetHistory();
      showToast?.(
        { kind: "success", text: "Готово — я дбайливо зберегла все у pricing.yml ♡" },
        2500
      );
    } catch (caught) {
      if (caught?.status === 409) {
        // Version conflict: keep the user's edits, fetch the new server hash so
        // they can choose to overwrite or reload (issue #8).
        let latestHash = null;
        try {
          const latest = await api.get("/api/ops/pricing", { timeoutMs: 20000 });
          if (latest && latest.ok !== false) latestHash = latest.hash;
        } catch {
          // ignore — overwrite stays disabled when we can't read the new hash
        }
        setConflict({ latestHash });
        showToast?.(
          {
            kind: "error",
            text: "Файл тим часом змінили на сервері. Не хвилюйтеся — ваші правки я зберегла у формі. Оберіть, будь ласка, дію нижче.",
          },
          5000
        );
      } else {
        showToast?.(
          { kind: "error", text: `Не вийшло зберегти: ${String(caught?.message || caught)}` },
          4000
        );
      }
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
              onClick={reload}
            >
              Перезавантажити
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={historyLen === 0 || saving}
              onClick={undo}
            >
              Скасувати останню зміну
            </button>

            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={
                !dirty || saving || loading || hasErrors || isEmpty || readOnly
              }
              onClick={() => save()}
            >
              {saving ? "Збереження…" : "Зберегти у pricing.yml"}
            </button>

            {dirty ? (
              <span className={styles.pricingDirty}>Є незбережені зміни</span>
            ) : null}
          </div>

          {readOnly ? (
            <div className={styles.pricingConflict}>
              <strong>Лише для читання.</strong> {readOnlyReason}
            </div>
          ) : null}

          {conflict ? (
            <div className={styles.pricingConflict}>
              <strong>Конфлікт версій.</strong> Файл було змінено на сервері після
              завантаження. Ваші зміни збережено у формі.
              <div className={styles.pricingConflictActions}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={saving || conflict.latestHash == null}
                  onClick={() => save(conflict.latestHash)}
                >
                  Перезаписати моїми змінами
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={saving}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Відхилити ваші зміни і завантажити версію з сервера? Ваші правки буде втрачено."
                      )
                    ) {
                      load();
                    }
                  }}
                >
                  Завантажити версію з сервера
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </FieldRow>

      <FieldRow
        label="Змінні"
        hint="✎ — перейменувати ключ; × — видалити значення; «Додати поле» — створити нове (текст, число, так/ні, вкладена група або масив)."
      >
        {loading ? (
          <div className="text-muted">Хвилинку, будь ласка… я відкриваю pricing.yml.</div>
        ) : error ? (
          <div className={styles.pricingError}>{error}</div>
        ) : tree ? (
          <div className={styles.pricingTree}>
            {hasErrors ? (
              <div className={styles.pricingError}>
                Є помилки валідації — виправте позначені поля перед збереженням.
              </div>
            ) : null}

            {isEmpty ? (
              <div className={styles.pricingError}>
                Конфігурація порожня — додайте хоча б один ключ, щоб зберегти.
              </div>
            ) : null}

            {Object.keys(tree).map((key) => (
              <PricingNode
                key={key}
                nodeKey={key}
                value={tree[key]}
                path={[key]}
                siblingKeys={Object.keys(tree)}
                onSet={onSet}
                onDelete={onDelete}
                onRename={onRename}
                getError={getError}
                getFormat={getFormat}
                disabled={editingDisabled}
              />
            ))}

            <AddFieldRow
              existingKeys={Object.keys(tree)}
              disabled={editingDisabled}
              onAdd={(key, value) => onSet([key], value)}
            />
          </div>
        ) : (
          <div className="text-muted">Немає даних.</div>
        )}
      </FieldRow>

      <FieldRow
        label="Перегляд YAML"
        hint="Версія файлу з сервера на момент завантаження (тільки для читання)."
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
            <>
              {dirty ? (
                <div className={styles.pricingRawNote}>
                  ⚠ Це версія з сервера на момент завантаження. Незбережені зміни
                  у формі вище тут <strong>не</strong> відображаються.
                </div>
              ) : null}
              <pre className={styles.pricingRaw}>{meta.raw || "—"}</pre>
            </>
          ) : null}
        </div>
      </FieldRow>
    </Card>
  );
}
