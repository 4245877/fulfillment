import React, { useEffect, useMemo, useState } from "react";

import { inventoryApi } from "../api/inventoryApi.js";
import styles from "./Inventory.module.css";

const MATERIALS = ["PLA", "PETG", "TPU", "ABS", "ASA"];

const COLORS = [
  ["black", "Чорний"],
  ["white", "Білий"],
  ["gray", "Сірий"],
  ["red", "Червоний"],
  ["blue", "Синій"],
  ["green", "Зелений"],
  ["yellow", "Жовтий"],
  ["transparent", "Прозорий"],
];

const PRINTERS = [
  ["ender3-v3-ke", "Ender 3 V3 KE"],
  ["creality-k2", "Creality K2"],
  ["bambu-a1-combo", "Bambu Lab A1 Combo"],
];

const MOVEMENT_TYPES = [
  ["add", "Додавання"],
  ["consume", "Списання"],
  ["adjust", "Коригування"],
  ["load_printer_filament", "Заміна пластику на принтері"],
];

const MOVEMENT_SOURCES = [
  ["dashboard", "Панель керування"],
  ["api", "API"],
  ["system", "Система"],
  ["printer", "Принтер"],
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
  if (status === "good") return "Достатньо";

  return "Невідомо";
}

function getColorName(color) {
  return COLORS.find(([value]) => value === color)?.[1] || color;
}

function getPrinterName(printerId) {
  return PRINTERS.find(([value]) => value === printerId)?.[1] || printerId;
}

function getMovementTypeLabel(type) {
  return MOVEMENT_TYPES.find(([value]) => value === type)?.[1] || "Невідомо";
}

function getMovementSourceLabel(source) {
  return MOVEMENT_SOURCES.find(([value]) => value === source)?.[1] || "Невідомо";
}

function getStatusClassName(status) {
  return [
    styles.status,
    styles[`status_${status}`] || styles.status_unknown,
  ].join(" ");
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [addForm, setAddForm] = useState({
    material: "PLA",
    color: "black",
    quantityG: 1000,
    note: "",
  });

  const [adjustForm, setAdjustForm] = useState({
    material: "PLA",
    color: "black",
    actualG: 1000,
    note: "",
  });

  const [consumeForm, setConsumeForm] = useState({
    material: "PLA",
    color: "black",
    quantityG: 100,
    note: "",
  });

  const [loadForm, setLoadForm] = useState({
    printerId: "ender3-v3-ke",
    material: "PLA",
    color: "black",
  });

  const totalG = useMemo(() => {
    return stock.reduce((sum, item) => sum + Number(item.stockG || 0), 0);
  }, [stock]);

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
      await loadData();
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

  function isPositiveNumber(value) {
    const num = Number(value);

    return Number.isFinite(num) && num > 0;
  }

  function isNonNegativeNumber(value) {
    const num = Number(value);

    return Number.isFinite(num) && num >= 0;
  }

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
                    <tr key={item.id}>
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
              {printerFilament.map((item) => (
                <div key={item.id} className={styles.smallCard}>
                  <strong>{getPrinterName(item.printerId)}</strong>
                  <span>
                    {item.material} {item.colorName || getColorName(item.color)}
                  </span>
                </div>
              ))}
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
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();

            if (!isPositiveNumber(addForm.quantityG)) {
              setError("Вкажи кількість більше 0");
              return;
            }

            runAction(
              () =>
                inventoryApi.add({
                  ...addForm,
                  colorName: getColorName(addForm.color),
                  quantityG: Number(addForm.quantityG),
                  source: "dashboard",
                }),
              "Філамент додано"
            );
          }}
        >
          <h2>Додати філамент</h2>

          <Field label="Матеріал">
            <select
              value={addForm.material}
              onChange={(event) => updateForm(setAddForm, "material", event.target.value)}
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
              value={addForm.color}
              onChange={(event) => updateForm(setAddForm, "color", event.target.value)}
            >
              {COLORS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Кількість, г">
            <input
              type="number"
              min="1"
              value={addForm.quantityG}
              onChange={(event) => updateForm(setAddForm, "quantityG", event.target.value)}
            />
          </Field>

          <Field label="Примітка">
            <input
              value={addForm.note}
              onChange={(event) => updateForm(setAddForm, "note", event.target.value)}
              placeholder="Наприклад: нова котушка"
            />
          </Field>

          <button type="submit" disabled={busy}>
            Додати
          </button>
        </form>

        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();

            if (!isPositiveNumber(consumeForm.quantityG)) {
              setError("Вкажи кількість більше 0");
              return;
            }

            runAction(
              () =>
                inventoryApi.consume({
                  ...consumeForm,
                  quantityG: Number(consumeForm.quantityG),
                  source: "dashboard",
                }),
              "Філамент списано"
            );
          }}
        >
          <h2>Списати вручну</h2>

          <Field label="Матеріал">
            <select
              value={consumeForm.material}
              onChange={(event) =>
                updateForm(setConsumeForm, "material", event.target.value)
              }
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
              value={consumeForm.color}
              onChange={(event) => updateForm(setConsumeForm, "color", event.target.value)}
            >
              {COLORS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Кількість, г">
            <input
              type="number"
              min="1"
              value={consumeForm.quantityG}
              onChange={(event) =>
                updateForm(setConsumeForm, "quantityG", event.target.value)
              }
            />
          </Field>

          <Field label="Примітка">
            <input
              value={consumeForm.note}
              onChange={(event) => updateForm(setConsumeForm, "note", event.target.value)}
              placeholder="Наприклад: тестовий друк"
            />
          </Field>

          <button type="submit" disabled={busy}>
            Списати
          </button>
        </form>

        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();

            if (!isNonNegativeNumber(adjustForm.actualG)) {
              setError("Вкажи фактичний залишок 0 або більше");
              return;
            }

            runAction(
              () =>
                inventoryApi.adjust({
                  ...adjustForm,
                  colorName: getColorName(adjustForm.color),
                  actualG: Number(adjustForm.actualG),
                  source: "dashboard",
                }),
              "Залишок скориговано"
            );
          }}
        >
          <h2>Коригування</h2>

          <Field label="Матеріал">
            <select
              value={adjustForm.material}
              onChange={(event) =>
                updateForm(setAdjustForm, "material", event.target.value)
              }
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
              value={adjustForm.color}
              onChange={(event) => updateForm(setAdjustForm, "color", event.target.value)}
            >
              {COLORS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Фактичний залишок, г">
            <input
              type="number"
              min="0"
              value={adjustForm.actualG}
              onChange={(event) => updateForm(setAdjustForm, "actualG", event.target.value)}
            />
          </Field>

          <Field label="Примітка">
            <input
              value={adjustForm.note}
              onChange={(event) => updateForm(setAdjustForm, "note", event.target.value)}
              placeholder="Наприклад: звірка полиці"
            />
          </Field>

          <button type="submit" disabled={busy}>
            Встановити залишок
          </button>
        </form>

        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();

            runAction(
              () =>
                inventoryApi.loadPrinterFilament({
                  ...loadForm,
                  colorName: getColorName(loadForm.color),
                }),
              "Філамент на принтері оновлено"
            );
          }}
        >
          <h2>Філамент на принтері</h2>

          <Field label="Принтер">
            <select
              value={loadForm.printerId}
              onChange={(event) => updateForm(setLoadForm, "printerId", event.target.value)}
            >
              {PRINTERS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
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
                  <th>Кількість</th>
                  <th>Було</th>
                  <th>Стало</th>
                  <th>Джерело</th>
                  <th>Примітка</th>
                </tr>
              </thead>

              <tbody>
                {movements.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDate(item.createdAt)}</td>
                    <td>{getMovementTypeLabel(item.type)}</td>
                    <td>{formatGram(item.quantityG)}</td>
                    <td>{formatGram(item.beforeG)}</td>
                    <td>{formatGram(item.afterG)}</td>
                    <td>{getMovementSourceLabel(item.source)}</td>
                    <td>{item.note || "—"}</td>
                  </tr>
                ))}
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