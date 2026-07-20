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
  ["consume", "Списать"],
  ["add", "Добавить"],
  ["adjust", "Скорректировать"],
  ["edit", "Изменить данные"],
];

function formatGram(value) {
  const num = Number(value || 0);

  return `${num.toLocaleString("ru-RU")} г`;
}

function formatKg(value) {
  const num = Number(value || 0) / 1000;

  return `${num.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} кг`;
}

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("ru-RU");
}

function getStatusLabel(status) {
  if (status === "critical") return "Критический";
  if (status === "low") return "Низкий";
  if (status === "ok" || status === "good") return "Достаточно";

  return "Неизвестно";
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
    colorName: "Чёрный",
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
      setError(
        err instanceof Error
          ? err.message
          : "Ой… мне не удалось загрузить склад. Попробуйте, пожалуйста, ещё раз."
      );
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
      setError(err instanceof Error ? err.message : "Действие не выполнено");
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
        setError("Укажите, пожалуйста, количество больше 0");
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
        "Готово — я списала филамент"
      );
      return;
    }

    if (form.action === "add") {
      if (!isPositiveNumber(form.quantityG)) {
        setError("Укажите, пожалуйста, количество больше 0");
        return;
      }

      runAction(
        () =>
          inventoryApi.add({
            ...base,
            quantityG: Number(form.quantityG),
          }),
        "Готово — я добавила филамент на склад ♡"
      );
      return;
    }

    if (form.action === "adjust") {
      if (!isNonNegativeNumber(form.actualG)) {
        setError("Укажите фактический остаток 0 или больше");
        return;
      }

      runAction(
        () =>
          inventoryApi.adjust({
            ...base,
            actualG: Number(form.actualG),
          }),
        "Готово — я скорректировала остаток"
      );
      return;
    }

    // edit — descriptive data only, requires an existing position.
    if (!selected) {
      setError("Выберите, пожалуйста, позицию в таблице — тогда я смогу изменить её данные");
      return;
    }

    if (!isNonNegativeNumber(form.lowStockG) || !isNonNegativeNumber(form.criticalStockG)) {
      setError("Пороги должны быть 0 или больше");
      return;
    }

    if (Number(form.criticalStockG) > Number(form.lowStockG)) {
      setError("Критический порог не может быть больше низкого");
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
      "Готово — я обновила данные филамента"
    );
  }

  function submitLoadPrinter(event) {
    event.preventDefault();

    const printerId = String(loadForm.printerId || "").trim();
    if (!printerId) {
      setError("Выберите или укажите принтер");
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
      "Готово — я обновила филамент на принтере"
    );
  }

  const submitLabel = {
    consume: "Списать",
    add: "Добавить",
    adjust: "Установить остаток",
    edit: "Сохранить изменения",
  }[form.action];

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>Учёт склада</div>
          <h1>Склад филамента</h1>
          <p>
            Я веду учёт остатков по типу и цвету — без нумерации каждой
            катушки.
          </p>
        </div>

        <div className={styles.totalCard}>
          <span>Всего филамента</span>
          <strong>{formatKg(totalG)}</strong>
        </div>
      </header>

      {loading ? (
        <div className={styles.notice}>
          Минутку, пожалуйста… я пересчитываю катушки.
        </div>
      ) : null}
      {message ? <div className={styles.success}>{message}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Остатки</h2>
            <button
              type="button"
              onClick={() => loadData({ silent: true })}
              disabled={busy || refreshing}
            >
              {refreshing ? "Минутку…" : "Обновить"}
            </button>
          </div>

          {loading ? null : stock.length ? (
            <>
              <p className={styles.tableHint}>
                Нажмите на строку — и я сама подставлю данные в форму операции.
              </p>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Материал</th>
                      <th>Цвет</th>
                      <th>Остаток</th>
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
              Здесь пока что пусто. Добавьте первую катушку ниже — и я начну
              бережно вести учёт ♡
            </div>
          )}
        </section>

        <section className={styles.panel}>
          <h2>Филамент на принтерах</h2>

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
              Ещё не указано, какой пластик стоит на принтерах.
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
            <h2>Операция с филаментом</h2>
            {selected ? (
              <span className={styles.selectedChip}>
                {selected.material} {selected.colorName || getColorName(selected.color)}
                {" · "}
                {formatKg(selected.stockG)}
              </span>
            ) : (
              <span className={styles.newChip}>Новая позиция</span>
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
            <Field label="Материал">
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

            <Field label="Цвет">
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
              Выберите существующую позицию в таблице, чтобы редактировать её данные.
            </p>
          ) : null}

          {form.action === "consume" || form.action === "add" ? (
            <Field label="Количество, г">
              <input
                type="number"
                min="1"
                value={form.quantityG}
                onChange={(event) => updateForm(setForm, "quantityG", event.target.value)}
              />
            </Field>
          ) : null}

          {form.action === "adjust" ? (
            <Field label="Фактический остаток, г">
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
              <Field label="Название цвета">
                <input
                  value={form.colorName}
                  onChange={(event) => updateForm(setForm, "colorName", event.target.value)}
                  placeholder="Например: Угольный"
                />
              </Field>

              <div className={styles.opFields}>
                <Field label="Низкий порог, г">
                  <input
                    type="number"
                    min="0"
                    value={form.lowStockG}
                    onChange={(event) => updateForm(setForm, "lowStockG", event.target.value)}
                  />
                </Field>

                <Field label="Критический порог, г">
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
                <span>Активная позиция (показывать на складе)</span>
              </label>
            </>
          ) : (
            <Field label="Примечание">
              <input
                value={form.note}
                onChange={(event) => updateForm(setForm, "note", event.target.value)}
                placeholder="Например: новая катушка"
              />
            </Field>
          )}

          <button type="submit" disabled={busy}>
            {submitLabel}
          </button>
        </form>

        <form className={styles.form} onSubmit={submitLoadPrinter}>
          <h2>Филамент на принтере</h2>

          <Field label="Принтер">
            {printerList.length ? (
              <select
                value={loadForm.printerId}
                onChange={(event) => updateForm(setLoadForm, "printerId", event.target.value)}
              >
                <option value="">— выберите принтер —</option>
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
                placeholder="Идентификатор принтера"
              />
            )}
          </Field>

          <Field label="Материал">
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

          <Field label="Цвет">
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
            Сохранить
          </button>
        </form>
      </div>

      <section className={styles.panel}>
        <h2>Последние движения</h2>

        {loading ? null : movements.length ? (
          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.movementsTable}`}>
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Тип</th>
                  <th>Принтер</th>
                  <th>Позиция</th>
                  <th>Количество</th>
                  <th>Было → Стало</th>
                  <th>Источник</th>
                  <th>Детали</th>
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
                          <span className={styles.archivedTag}>архив</span>
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
                            title={`Задание печати: ${item.printJobId}`}
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
          <div className={styles.empty}>
            История движений пока пуста — как только что-то изменится, я всё
            аккуратно запишу.
          </div>
        )}
      </section>
    </div>
  );
}
