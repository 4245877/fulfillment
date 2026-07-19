import React, { useEffect, useMemo, useRef, useState } from "react";

import { inventoryApi } from "../api/inventoryApi.js";
import { fetchPrinterStatuses } from "../api/printerFarmApi.js";
import styles from "./Inventory.module.css";
import {
  COLORS,
  MATERIALS,
  getColorName,
  getMovementSourceLabel,
  getMovementTypeLabel,
} from "./inventoryVocab.js";
import {
  buildPrinterNameMap,
  resolvePositionLabel,
  resolvePrinterLabel,
  shortId,
} from "./inventoryMovements.js";

// The unified operation form drives every action against a stock position.
const ACTIONS = [
  ["consume", "Списати"],
  ["add", "Додати"],
  ["adjust", "Коригувати"],
  ["edit", "Змінити дані"],
];

function formatGram(value) {
  const num = Number(value || 0);

  return `${num.toLocaleString("uk-UA")} г`;
}

function formatKg(value) {
  const num = Number(value || 0) / 1000;

  return `${num.toLocaleString("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} кг`;
}

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("uk-UA");
}

function getStatusLabel(status) {
  if (status === "critical") return "Критичний";
  if (status === "low") return "Низький";
  if (status === "ok" || status === "good") return "Достатньо";

  return "Невідомо";
}

function getStatusClassName(status) {
  // The API reports "ok"; the good badge styling is keyed on "good".
  const key = status === "ok" ? "good" : status;

  return [styles.status, styles[`status_${key}`] || styles.status_unknown].join(
    " "
  );
}

function Field({ label, children }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function Inventory() {
  const [stock, setStock] = useState([]);
  const [movements, setMovements] = useState([]);
  const [printerFilament, setPrinterFilament] = useState([]);
  // Live printer id → name map, fetched best-effort from the printer-status API
  // (never hardcoded). Empty when that API is unavailable — the movements table
  // then falls back to the raw printer id instead of breaking.
  const [printerNames, setPrinterNames] = useState(() => new Map());
  const [printerList, setPrinterList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const operationRef = useRef(null);

  // One form drives all four actions against a single material+color position.
  const [form, setForm] = useState({
    action: "consume",
    material: "PLA",
    color: "black",
    colorName: "Чорний",
    quantityG: 1000,
    actualG: 0,
    lowStockG: 1000,
    criticalStockG: 300,
    enabled: true,
    note: "",
  });

  const [loadForm, setLoadForm] = useState({
    printerId: "",
    material: "PLA",
    color: "black",
  });

  const totalG = useMemo(() => {
    return stock.reduce((sum, item) => sum + Number(item.stockG || 0), 0);
  }, [stock]);

  // The existing stock row the form currently targets, if any.
  const selected = useMemo(
    () =>
      stock.find(
        (item) => item.material === form.material && item.color === form.color
      ) || null,
    [stock, form.material, form.color]
  );

  async function loadData({ silent = false } = {}) {
    setError("");

    if (!silent) setLoading(true);
    setRefreshing(true);

    try {
      const [stockResult, movementsResult, printerResult] = await Promise.all([
        inventoryApi.stock(),
        inventoryApi.movements(50),
        inventoryApi.printerFilament(),
      ]);

      // Best-effort: a printer-status outage must NOT fail the whole page — the
      // movements table degrades to raw printer ids instead of crashing.
      const statusPayload = await fetchPrinterStatuses().catch(() => null);
      const nameMap = buildPrinterNameMap(statusPayload);
      setPrinterNames(nameMap);
      setPrinterList([...nameMap].map(([id, name]) => ({ id, name })));

      setStock(Array.isArray(stockResult.items) ? stockResult.items : []);
      setMovements(Array.isArray(movementsResult.items) ? movementsResult.items : []);
      setPrinterFilament(Array.isArray(printerResult.items) ? printerResult.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося завантажити склад");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!message) return undefined;

    const timer = window.setTimeout(() => {
      setMessage("");
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [message]);

  async function runAction(action, successText) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await action();
      setMessage(successText);
      await loadData({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Дія не виконана");
    } finally {
      setBusy(false);
    }
  }

  function updateForm(setter, key, value) {
    setter((current) => ({
      ...current,
      [key]: value,
    }));
  }

  // Pull an existing position's data into the operation form; falls back to
  // sensible defaults for a material+color that isn't in stock yet.
  function applyTarget(material, color) {
    const item = stock.find(
      (entry) => entry.material === material && entry.color === color
    );

    setForm((current) => ({
      ...current,
      material,
      color,
      colorName: item?.colorName || getColorName(color),
      actualG: item ? Number(item.stockG) : current.actualG,
      lowStockG: item ? Number(item.lowStockG) : current.lowStockG,
      criticalStockG: item ? Number(item.criticalStockG) : current.criticalStockG,
      enabled: item ? Boolean(item.enabled) : true,
    }));
  }

  // Clicking a stock row selects it: fills the operation form and the
  // printer-load form, then scrolls the form into view.
  function selectStock(item) {
    setForm((current) => ({
      ...current,
      material: item.material,
      color: item.color,
      colorName: item.colorName || getColorName(item.color),
      actualG: Number(item.stockG),
      lowStockG: Number(item.lowStockG),
      criticalStockG: Number(item.criticalStockG),
      enabled: Boolean(item.enabled),
    }));

    setLoadForm((current) => ({
      ...current,
      material: item.material,
      color: item.color,
    }));

    operationRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function isPositiveNumber(value) {
    const num = Number(value);

    return Number.isFinite(num) && num > 0;
  }

  function isNonNegativeNumber(value) {
    const num = Number(value);

    return Number.isFinite(num) && num >= 0;
  }

  function submitOperation(event) {
    event.preventDefault();

    const base = {
      material: form.material,
      color: form.color,
      colorName: form.colorName || getColorName(form.color),
      note: form.note,
      source: "dashboard",
    };

    if (form.action === "consume") {
      if (!isPositiveNumber(form.quantityG)) {
        setError("Вкажи кількість більше 0");
        return;
      }

      runAction(
        () =>
          inventoryApi.consume({
            material: base.material,
            color: base.color,
            quantityG: Number(form.quantityG),
            note: base.note,
            source: base.source,
          }),
        "Філамент списано"
      );
      return;
    }

    if (form.action === "add") {
      if (!isPositiveNumber(form.quantityG)) {
        setError("Вкажи кількість більше 0");
        return;
      }

      runAction(
        () =>
          inventoryApi.add({
            ...base,
            quantityG: Number(form.quantityG),
          }),
        "Філамент додано"
      );
      return;
    }

    if (form.action === "adjust") {
      if (!isNonNegativeNumber(form.actualG)) {
        setError("Вкажи фактичний залишок 0 або більше");
        return;
      }

      runAction(
        () =>
          inventoryApi.adjust({
            ...base,
            actualG: Number(form.actualG),
          }),
        "Залишок скориговано"
      );
      return;
    }

    // edit — descriptive data only, requires an existing position.
    if (!selected) {
      setError("Оберіть існуючу позицію в таблиці, щоб змінити її дані");
      return;
    }

    if (!isNonNegativeNumber(form.lowStockG) || !isNonNegativeNumber(form.criticalStockG)) {
      setError("Пороги мають бути 0 або більше");
      return;
    }

    if (Number(form.criticalStockG) > Number(form.lowStockG)) {
      setError("Критичний поріг не може бути більшим за низький");
      return;
    }

    runAction(
      () =>
        inventoryApi.update({
          id: selected.id,
          colorName: form.colorName || getColorName(form.color),
          lowStockG: Number(form.lowStockG),
          criticalStockG: Number(form.criticalStockG),
          enabled: Boolean(form.enabled),
        }),
      "Дані філаменту оновлено"
    );
  }

  function submitLoadPrinter(event) {
    event.preventDefault();

    const printerId = String(loadForm.printerId || "").trim();
    if (!printerId) {
      setError("Оберіть або вкажіть принтер");
      return;
    }

    runAction(
      () =>
        inventoryApi.loadPrinterFilament({
          printerId,
          material: loadForm.material,
          color: loadForm.color,
          colorName: getColorName(loadForm.color),
        }),
      "Філамент на принтері оновлено"
    );
  }

  const submitLabel = {
    consume: "Списати",
    add: "Додати",
    adjust: "Встановити залишок",
    edit: "Зберегти зміни",
  }[form.action];

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>Облік складу</div>
          <h1>Склад філаменту</h1>
          <p>
            Простий облік залишків за типом і кольором без нумерації кожної
            котушки.
          </p>
        </div>

        <div className={styles.totalCard}>
          <span>Усього філаменту</span>
          <strong>{formatKg(totalG)}</strong>
        </div>
      </header>

      {loading ? <div className={styles.notice}>Завантаження…</div> : null}
      {message ? <div className={styles.success}>{message}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Залишки</h2>
            <button
              type="button"
              onClick={() => loadData({ silent: true })}
              disabled={busy || refreshing}
            >
              {refreshing ? "Оновлення…" : "Оновити"}
            </button>
          </div>

          {loading ? null : stock.length ? (
            <>
              <p className={styles.tableHint}>
                Натисни на рядок, щоб підставити дані у форму операції.
              </p>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Матеріал</th>
                      <th>Колір</th>
                      <th>Залишок</th>
                      <th>Статус</th>
                    </tr>
                  </thead>

                  <tbody>
                    {stock.map((item) => (
                      <tr
                        key={item.id}
                        className={`${styles.clickableRow} ${
                          selected?.id === item.id ? styles.rowSelected : ""
                        }`}
                        onClick={() => selectStock(item)}
                        tabIndex={0}
                        role="button"
                        aria-pressed={selected?.id === item.id}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            selectStock(item);
                          }
                        }}
                      >
                        <td>{item.material}</td>
                        <td>{item.colorName || getColorName(item.color)}</td>
                        <td>
                          <strong>{formatKg(item.stockG)}</strong>
                          <div className={styles.muted}>{formatGram(item.stockG)}</div>
                        </td>
                        <td>
                          <span className={getStatusClassName(item.status)}>
                            {getStatusLabel(item.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className={styles.empty}>
              Поки немає жодної позиції. Додай першу котушку нижче.
            </div>
          )}
        </section>

        <section className={styles.panel}>
          <h2>Філамент на принтерах</h2>

          {loading ? null : printerFilament.length ? (
            <div className={styles.cards}>
              {printerFilament.map((item) => {
                const printer = resolvePrinterLabel(item.printerId, printerNames);
                return (
                  <div key={item.id} className={styles.smallCard}>
                    <strong title={printer.title || undefined}>{printer.text}</strong>
                    <span>
                      {item.material} {item.colorName || getColorName(item.color)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.empty}>
              Ще не вказано, який пластик стоїть на принтерах.
            </div>
          )}
        </section>
      </div>

      <div className={styles.formsGrid}>
        <form
          ref={operationRef}
          className={`${styles.form} ${styles.operationForm}`}
          onSubmit={submitOperation}
        >
          <div className={styles.opHeader}>
            <h2>Операція з філаментом</h2>
            {selected ? (
              <span className={styles.selectedChip}>
                {selected.material} {selected.colorName || getColorName(selected.color)}
                {" · "}
                {formatKg(selected.stockG)}
              </span>
            ) : (
              <span className={styles.newChip}>Нова позиція</span>
            )}
          </div>

          <div className={styles.opTabs} role="tablist">
            {ACTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={form.action === value}
                className={`${styles.opTab} ${
                  form.action === value ? styles.opTabActive : ""
                }`}
                onClick={() => updateForm(setForm, "action", value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={styles.opFields}>
            <Field label="Матеріал">
              <select
                value={form.material}
                onChange={(event) => applyTarget(event.target.value, form.color)}
                disabled={form.action === "edit"}
              >
                {MATERIALS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Колір">
              <select
                value={form.color}
                onChange={(event) => applyTarget(form.material, event.target.value)}
                disabled={form.action === "edit"}
              >
                {COLORS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {form.action === "edit" && !selected ? (
            <p className={styles.tableHint}>
              Оберіть існуючу позицію в таблиці, щоб редагувати її дані.
            </p>
          ) : null}

          {form.action === "consume" || form.action === "add" ? (
            <Field label="Кількість, г">
              <input
                type="number"
                min="1"
                value={form.quantityG}
                onChange={(event) => updateForm(setForm, "quantityG", event.target.value)}
              />
            </Field>
          ) : null}

          {form.action === "adjust" ? (
            <Field label="Фактичний залишок, г">
              <input
                type="number"
                min="0"
                value={form.actualG}
                onChange={(event) => updateForm(setForm, "actualG", event.target.value)}
              />
            </Field>
          ) : null}

          {form.action === "edit" ? (
            <>
              <Field label="Назва кольору">
                <input
                  value={form.colorName}
                  onChange={(event) => updateForm(setForm, "colorName", event.target.value)}
                  placeholder="Наприклад: Вугільний"
                />
              </Field>

              <div className={styles.opFields}>
                <Field label="Низький поріг, г">
                  <input
                    type="number"
                    min="0"
                    value={form.lowStockG}
                    onChange={(event) => updateForm(setForm, "lowStockG", event.target.value)}
                  />
                </Field>

                <Field label="Критичний поріг, г">
                  <input
                    type="number"
                    min="0"
                    value={form.criticalStockG}
                    onChange={(event) =>
                      updateForm(setForm, "criticalStockG", event.target.value)
                    }
                  />
                </Field>
              </div>

              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) => updateForm(setForm, "enabled", event.target.checked)}
                />
                <span>Активна позиція (показувати на складі)</span>
              </label>
            </>
          ) : (
            <Field label="Примітка">
              <input
                value={form.note}
                onChange={(event) => updateForm(setForm, "note", event.target.value)}
                placeholder="Наприклад: нова котушка"
              />
            </Field>
          )}

          <button type="submit" disabled={busy}>
            {submitLabel}
          </button>
        </form>

        <form className={styles.form} onSubmit={submitLoadPrinter}>
          <h2>Філамент на принтері</h2>

          <Field label="Принтер">
            {printerList.length ? (
              <select
                value={loadForm.printerId}
                onChange={(event) => updateForm(setLoadForm, "printerId", event.target.value)}
              >
                <option value="">— оберіть принтер —</option>
                {printerList.map((printer) => (
                  <option key={printer.id} value={printer.id}>
                    {printer.name}
                  </option>
                ))}
              </select>
            ) : (
              // Printer-status API unavailable: keep the form usable with a
              // free-text id instead of an empty, unselectable dropdown.
              <input
                value={loadForm.printerId}
                onChange={(event) => updateForm(setLoadForm, "printerId", event.target.value)}
                placeholder="Ідентифікатор принтера"
              />
            )}
          </Field>

          <Field label="Матеріал">
            <select
              value={loadForm.material}
              onChange={(event) => updateForm(setLoadForm, "material", event.target.value)}
            >
              {MATERIALS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Колір">
            <select
              value={loadForm.color}
              onChange={(event) => updateForm(setLoadForm, "color", event.target.value)}
            >
              {COLORS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <button type="submit" disabled={busy}>
            Зберегти
          </button>
        </form>
      </div>

      <section className={styles.panel}>
        <h2>Останні рухи</h2>

        {loading ? null : movements.length ? (
          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.movementsTable}`}>
              <thead>
                <tr>
                  <th>Час</th>
                  <th>Тип</th>
                  <th>Принтер</th>
                  <th>Позиція</th>
                  <th>Кількість</th>
                  <th>Було → Стало</th>
                  <th>Джерело</th>
                  <th>Деталі</th>
                </tr>
              </thead>

              <tbody>
                {movements.map((item) => {
                  const printer = resolvePrinterLabel(item.printerId, printerNames);
                  const position = resolvePositionLabel(item);

                  return (
                    <tr key={item.id}>
                      <td>{formatDate(item.createdAt)}</td>
                      <td>{getMovementTypeLabel(item.type)}</td>
                      <td>
                        <span
                          className={printer.unknown ? styles.muted : undefined}
                          title={printer.title || undefined}
                        >
                          {printer.text}
                        </span>
                      </td>
                      <td>
                        <span
                          className={position.unknown ? styles.muted : undefined}
                          title={position.title || undefined}
                        >
                          {position.text}
                        </span>
                        {position.archived ? (
                          <span className={styles.archivedTag}>архів</span>
                        ) : null}
                      </td>
                      <td>{formatGram(item.quantityG)}</td>
                      <td className={styles.muted}>
                        {formatGram(item.beforeG)} → {formatGram(item.afterG)}
                      </td>
                      <td>{getMovementSourceLabel(item.source)}</td>
                      <td>
                        {item.note ? (
                          <div className={styles.noteText} title={item.note}>
                            {item.note}
                          </div>
                        ) : null}
                        {item.printJobId ? (
                          <div
                            className={styles.jobBadge}
                            title={`Завдання друку: ${item.printJobId}`}
                          >
                            🖨 {shortId(item.printJobId)}
                          </div>
                        ) : null}
                        {!item.note && !item.printJobId ? (
                          <span className={styles.muted}>—</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.empty}>Історія рухів поки порожня.</div>
        )}
      </section>
    </div>
  );
}
