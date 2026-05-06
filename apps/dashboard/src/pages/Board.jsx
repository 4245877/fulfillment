import React, { useCallback, useEffect, useMemo, useState } from "react";

import { apiWB as api } from "../api/wallboardApi.js";
import { fetchPrinterStatuses } from "../api/printerFarmApi.js";
import { useSSE } from "../hooks/useSSE.js";

import "../styles/wallboard.css";

const DEFAULT_OPS = { stats: {} };
const DEFAULT_PRINTS = { printers: [], jobs: [], stats: {} };
const DEFAULT_PRINTER_MONITOR = { printers: [], error: "" };

const PRINTER_POLL_INTERVAL_MS = 5000;
const LAG_WARNING_MS = 5000;
const LAG_DANGER_MS = 60000;
const PROGRESS_SUCCESS_FROM = 80;
const PROGRESS_WARNING_FROM = 35;

const ORDER_STAGES = [
  ["PrePrintCheck", "Переддрукарська перевірка"],
  ["Queued", "У черзі"],
  ["Printing", "Друк"],
  ["PostProcess", "Післяобробка"],
  ["Packaging", "Пакування"],
  ["Shipment", "Відправлення"],
  ["Pickup", "Самовивіз"],
  ["Delivered", "Доставлено"],
  ["Issued", "Видано"],
];

const LOGISTICS_STATUSES = [
  ["new", "Нові"],
  ["inTransit", "У дорозі"],
  ["delivered", "Доставлено"],
  ["problem", "Проблемні"],
];

const QUEUE_ROWS = [
  { key: "prints", label: "Друк", readyKey: "ready", runningKey: "running" },
  { key: "imports", label: "Імпорт", readyKey: "backlog", runningKey: null },
  { key: "media", label: "Медіа", readyKey: "backlog", runningKey: null },
  { key: "webhooks", label: "Вебхуки", readyKey: "backlog", runningKey: null },
  { key: "notify", label: "Сповіщення", readyKey: "backlog", runningKey: null },
];

const SERVICE_ROWS = [
  ["API магазину", "shop"],
  ["API фулфілменту", "fulfillment"],
  ["Мережа принтерів", "printers"],
  ["PostgreSQL", "db"],
  ["Redis", "redis"],
  ["Індексатор пошуку", "indexer"],
];

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(current, next) {
  if (!isPlainObject(next)) {
    return next === undefined ? current : next;
  }

  const result = { ...(isPlainObject(current) ? current : {}) };

  Object.keys(next).forEach((key) => {
    const currentValue = result[key];
    const nextValue = next[key];

    if (Array.isArray(nextValue)) {
      result[key] = nextValue;
      return;
    }

    if (isPlainObject(nextValue)) {
      result[key] = deepMerge(currentValue, nextValue);
      return;
    }

    result[key] = nextValue;
  });

  return result;
}

function mergeOps(current, next) {
  if (!isPlainObject(next)) return current;
  return deepMerge(current, next);
}

function mergePrints(current, next) {
  if (!isPlainObject(next)) return current;

  return {
    ...current,
    ...next,
    stats: deepMerge(current.stats || {}, next.stats || {}),
    printers: Array.isArray(next.printers) ? next.printers : current.printers,
    jobs: Array.isArray(next.jobs) ? next.jobs : current.jobs,
  };
}

function formatInt(value) {
  return asNumber(value, 0).toLocaleString("uk-UA");
}

function formatFixed(value, digits = 1) {
  return asNumber(value, 0).toLocaleString("uk-UA", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
}

function formatHeaderTime(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatHeroDate(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("uk-UA", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

function formatLag(value) {
  const ms = asNumber(value, 0);

  if (ms >= 60000) {
    const minutes = ms / 60000;
    return `${minutes.toLocaleString("uk-UA", {
      minimumFractionDigits: minutes < 10 ? 1 : 0,
      maximumFractionDigits: 1,
    })} хв`;
  }

  if (ms >= 1000) {
    const seconds = ms / 1000;
    return `${seconds.toLocaleString("uk-UA", {
      minimumFractionDigits: seconds < 10 ? 1 : 0,
      maximumFractionDigits: 1,
    })} с`;
  }

  return `${formatInt(ms)} мс`;
}

function normalizePercent(value) {
  const n = asNumber(value, 0);
  const percent = n <= 1 ? n * 100 : n;
  return clamp(percent, 0, 100);
}

function formatPercent(value) {
  return `${Math.round(normalizePercent(value))}%`;
}

function formatTemperature(value) {
  return value == null ? "—" : `${formatInt(value)}°C`;
}

function getLagTone(value) {
  const ms = asNumber(value, 0);

  if (ms > LAG_DANGER_MS) return "danger";
  if (ms > LAG_WARNING_MS) return "warning";

  return "success";
}

function getAlertTone(level) {
  const v = String(level || "").toLowerCase();
  if (v === "error") return "danger";
  if (v === "warn" || v === "warning") return "warning";
  if (v === "ok" || v === "success") return "success";
  return "primary";
}

function getAlertLabel(level) {
  const v = String(level || "").toLowerCase();
  if (v === "error") return "Помилка";
  if (v === "warn" || v === "warning") return "Попередження";
  if (v === "ok" || v === "success") return "Добре";
  return "Інфо";
}

function getPrinterTone(state) {
  const v = String(state || "").toLowerCase();
  if (v === "printing" || v === "ready") return "success";
  if (v === "paused" || v === "maintenance") return "warning";
  if (v === "error" || v === "offline") return "danger";
  return "primary";
}

function getPrinterStateLabel(state) {
  const v = String(state || "").toLowerCase();

  const labels = {
    printing: "Друкує",
    ready: "Готовий",
    idle: "Очікує",
    paused: "Пауза",
    maintenance: "Обслуговування",
    error: "Помилка",
    offline: "Офлайн",
    unknown: "Невідомо",
  };

  return labels[v] || (state ? String(state) : "Невідомо");
}

function getServiceTone(status) {
  const v = String(status || "").toLowerCase();
  if (v === "up" || v === "ok" || v === "healthy") return "success";
  if (v === "degraded" || v === "warning") return "warning";
  return "danger";
}

function getServiceLabel(status) {
  const v = String(status || "").toLowerCase();
  if (v === "up" || v === "ok" || v === "healthy") return "Працює";
  if (v === "degraded" || v === "warning") return "Частково";
  if (v === "down") return "Недоступний";
  return status ? String(status) : "Недоступний";
}

function getProgressClass(value) {
  const percent = normalizePercent(value);

  if (percent >= PROGRESS_SUCCESS_FROM) return "row-progress-fill--success";
  if (percent >= PROGRESS_WARNING_FROM) return "row-progress-fill--warning";

  return "row-progress-fill--danger";
}

function toTagClass(tone = "primary") {
  const key = String(tone || "primary").toLowerCase();

  const map = {
    primary: "tag--primary",
    info: "tag--primary",
    success: "tag--success",
    ok: "tag--success",
    warning: "tag--warning",
    warn: "tag--warning",
    danger: "tag--danger",
    error: "tag--danger",
  };

  return map[key] || "";
}

function Panel({ title, subtitle, children, footer = null, loading = false, flush = false }) {
  return (
    <section className={`panel${loading ? " panel-loading" : ""}`}>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            <span className="panel-title-dot" />
            {title}
          </h2>

          {subtitle ? <div className="panel-subtitle">{subtitle}</div> : null}
        </div>
      </div>

      <div className={`panel-body${flush ? " panel-body--flush" : ""}`}>{children}</div>

      {footer ? <div className="panel-footer">{footer}</div> : null}
    </section>
  );
}

function StatusTag({ children, tone = "primary" }) {
  const toneClass = toTagClass(tone);
  return <span className={`tag${toneClass ? ` ${toneClass}` : ""}`}>{children}</span>;
}

function EmptyState({ title = "Немає даних", desc = "Зараз тут порожньо." }) {
  return (
    <div className="wboard-empty">
      <div className="wboard-empty-icon" aria-hidden="true">
        •
      </div>
      <h3 className="wboard-empty-title">{title}</h3>
      <p className="wboard-empty-desc">{desc}</p>
    </div>
  );
}

function KpiCard({ label, value, context, icon = "•", variant = "primary" }) {
  return (
    <div className={`kpi-card kpi-card--${variant}`}>
      <div className="kpi-card-top">
        <div className="kpi-card-icon" aria-hidden="true">
          <span>{icon}</span>
        </div>
      </div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {context ? <div className="kpi-context">{context}</div> : null}
    </div>
  );
}

function RowProgress({ value }) {
  const percent = normalizePercent(value);

  return (
    <div className="row-progress">
      <div className="row-progress-bar-track" aria-hidden="true">
        <div
          className={`row-progress-fill ${getProgressClass(percent)}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="row-progress-pct">{Math.round(percent)}%</span>
    </div>
  );
}

function HeroHeader({ updatedAt, loading }) {
  return (
    <header className="wallboard-hero">
      <div className="wallboard-hero-inner">
        <div>
          <div className="wallboard-hero-greeting">Lite Forest</div>
          <h1>Операційна панель</h1>
          <p className="wallboard-hero-sub">
            Замовлення, друк, логістика та стан сервісів в одному місці.
          </p>
        </div>

        <div className="wallboard-hero-meta">
          <div className="wallboard-hero-date">{formatHeroDate(updatedAt)}</div>
          <div className="wallboard-hero-time">{formatHeaderTime(updatedAt)}</div>
          <div className="wallboard-hero-status">
            <span className="wallboard-hero-status-dot" />
            {loading ? "Оновлення даних" : "Синхронізація активна"}
          </div>
        </div>
      </div>
    </header>
  );
}

function SectionOrders({ data = {}, loading = false }) {
  const orders = data.orders || {};
  const total = ORDER_STAGES.reduce((sum, [key]) => sum + asNumber(orders[key], 0), 0);

  return (
    <Panel
      loading={loading}
      title="Замовлення — конвеєр"
      subtitle="Кількість замовлень на кожному етапі"
      footer={<span className="panel-footer-meta">Разом у конвеєрі: {formatInt(total)}</span>}
    >
      <div className="kpi-grid">
        {ORDER_STAGES.map(([key, label]) => (
          <KpiCard
            key={key}
            label={label}
            value={formatInt(orders[key] || 0)}
            icon="◦"
            variant={orders[key] ? "primary" : "info"}
          />
        ))}
      </div>
    </Panel>
  );
}

function SectionPrintFarm({
  printers = [],
  jobs = [],
  livePrinters = [],
  monitorError = "",
  loading = false,
}) {
  const visiblePrinters = livePrinters.length ? livePrinters : printers;

  return (
    <Panel
      loading={loading}
      title="3D-ферма — моніторинг принтерів"
      subtitle="Живий стан обладнання, температури, файли та прогрес друку"
      footer={
        <>
          <span className="panel-footer-meta">Принтерів: {formatInt(visiblePrinters.length)}</span>
          <span className="panel-footer-meta">Активних робіт: {formatInt(jobs.length)}</span>
        </>
      }
    >
      {monitorError ? <div className="printer-monitor-alert">Помилка моніторингу: {monitorError}</div> : null}

      {visiblePrinters.length ? (
        <div className="printer-monitor-grid">
          {visiblePrinters.map((printer) => {
            const state =
              printer.status ||
              printer.state ||
              (printer.online === false ? "offline" : "unknown");

            const progress = normalizePercent(printer.progressPct ?? printer.progress ?? 0);

            const meta = [
              printer.protocol,
              printer.host,
              printer.model,
              printer.nozzle ? `Сопло ${printer.nozzle}` : null,
              printer.material_color || printer.material,
            ]
              .filter(Boolean)
              .join(" • ");

            return (
              <div className="printer-monitor-card" key={printer.id}>
                <div className="printer-monitor-top">
                  <div>
                    <div className="printer-monitor-name">
                      {printer.name || "Принтер без назви"}
                    </div>

                    <div className="printer-monitor-meta">
                      {meta || "Дані підключення не вказані"}
                    </div>
                  </div>

                  <StatusTag tone={getPrinterTone(state)}>{getPrinterStateLabel(state)}</StatusTag>
                </div>

                <div className="printer-monitor-file">
                  {printer.currentFile || "Файл не друкується"}
                </div>

                <div className="printer-monitor-progress">
                  <div
                    className={`printer-monitor-progress-fill ${getProgressClass(progress)}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className="printer-monitor-details">
                  <span>{Math.round(progress)}%</span>
                  <span>{printer.printed || "—"}</span>
                  <span>
                    {printer.remainingMinutes != null
                      ? `${formatInt(printer.remainingMinutes)} хв залишилося`
                      : "—"}
                  </span>
                </div>

                <div className="printer-monitor-details">
                  <span>Сопло: {formatTemperature(printer.nozzleTemp)}</span>
                  <span>Стіл: {formatTemperature(printer.bedTemp)}</span>
                </div>

                <div className="printer-monitor-updated">
                  Оновлено: {formatDateTime(printer.updatedAt)}
                </div>

                {printer.error ? <div className="printer-monitor-error">{printer.error}</div> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="Немає даних про принтери"
          desc="Список принтерів зʼявиться після першого успішного опитування API."
        />
      )}

      {jobs.length ? (
        <div className="wboard-table-wrap">
          <table className="wboard-table">
            <thead>
              <tr>
                <th>Замовлення</th>
                <th>SKU × кількість</th>
                <th>Принтер</th>
                <th>Прогрес</th>
                <th>Час завершення</th>
              </tr>
            </thead>

            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <div className="col-name">{job.order_number || "—"}</div>
                  </td>

                  <td>
                    <div className="col-amount">
                      {(job.sku || "—") + " ×" + formatInt(job.qty || 0)}
                    </div>
                  </td>

                  <td>{job.printer_name || "—"}</td>

                  <td>
                    <RowProgress value={job.progress || 0} />
                  </td>

                  <td>{formatDateTime(job.eta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}

function SectionQueues({ queues = {}, loading = false }) {
  const rows = QUEUE_ROWS.map(({ key, label, readyKey, runningKey }) => ({
    key,
    label,
    ready: queues[key]?.[readyKey] ?? 0,
    running: runningKey ? queues[key]?.[runningKey] ?? 0 : "—",
    lag: queues[key]?.lagMs ?? 0,
  }));

  return (
    <Panel loading={loading} title="Черги та відставання" subtitle="Розмір черг і час затримки">
      <div className="wboard-table-wrap">
        <table className="wboard-table">
          <thead>
            <tr>
              <th>Черга</th>
              <th>Готово / беклог</th>
              <th>Виконується</th>
              <th>Відставання</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="col-name">{row.label}</td>
                <td>{formatInt(row.ready)}</td>
                <td>{typeof row.running === "number" ? formatInt(row.running) : row.running}</td>
                <td>
                  <StatusTag tone={getLagTone(row.lag)}>{formatLag(row.lag)}</StatusTag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function SectionMaterials({ materials = {}, loading = false }) {
  const stock = Array.isArray(materials.stock) ? materials.stock : [];
  const low = Array.isArray(materials.low) ? materials.low : [];

  return (
    <Panel
      loading={loading}
      title="Склад пластика"
      subtitle="Залишки філаменту за матеріалом і кольором"
    >
      <div className="wallboard-grid-2">
        <KpiCard
          label="Філамент"
          value={`${formatFixed(materials.filamentKg ?? 0, 1)} кг`}
          icon="◔"
          variant="primary"
        />
        <KpiCard
          label="Позицій на складі"
          value={formatInt(stock.length)}
          icon="≡"
          variant="info"
        />
        <KpiCard
          label="Котушки в роботі"
          value={formatInt(materials.reelsInUse ?? 0)}
          icon="◎"
          variant="success"
        />
        <KpiCard
          label="Проблемні залишки"
          value={formatInt(low.length)}
          icon="!"
          variant={low.length ? "warning" : "info"}
        />
      </div>

      <div className="wallboard-stack-lg">
        {stock.length ? (
          <div className="wboard-table-wrap">
            <table className="wboard-table">
              <thead>
                <tr>
                  <th>Матеріал</th>
                  <th>Залишок</th>
                  <th>Статус</th>
                </tr>
              </thead>

              <tbody>
                {stock.slice(0, 8).map((item) => {
                  const status = String(item.status || "ok").toLowerCase();

                  return (
                    <tr key={item.id || `${item.material}-${item.color}`}>
                      <td className="col-name">
                        {item.material} {item.colorName || item.color}
                      </td>

                      <td>{formatFixed(item.remainKg ?? 0, 1)} кг</td>

                      <td>
                        <StatusTag
                          tone={
                            status === "critical"
                              ? "danger"
                              : status === "low"
                                ? "warning"
                                : "success"
                          }
                        >
                          {status === "critical"
                            ? "CRITICAL"
                            : status === "low"
                              ? "LOW"
                              : "OK"}
                        </StatusTag>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Склад пластику порожній"
            desc="Після першого поповнення залишки зʼявляться тут."
          />
        )}
      </div>
    </Panel>
  );
}

function SectionLogistics({ logistics = {}, loading = false }) {
  const byCarrier =
    logistics.byCarrier && typeof logistics.byCarrier === "object" ? logistics.byCarrier : null;

  return (
    <Panel
      loading={loading}
      title="Логістика"
      subtitle="Статуси відправлень та розподіл за перевізниками"
    >
      <div className="kpi-grid">
        {LOGISTICS_STATUSES.map(([key, label]) => (
          <KpiCard
            key={key}
            label={label}
            value={formatInt(logistics[key] || 0)}
            icon={key === "problem" ? "!" : "◦"}
            variant={key === "problem" ? "danger" : "primary"}
          />
        ))}
      </div>

      <div className="wallboard-stack-lg">
        {byCarrier ? (
          <div className="wboard-table-wrap">
            <table className="wboard-table">
              <thead>
                <tr>
                  <th>Перевізник</th>
                  <th>Нові</th>
                  <th>У дорозі</th>
                  <th>Доставлено</th>
                  <th>Проблемні</th>
                </tr>
              </thead>

              <tbody>
                {Object.entries(byCarrier).map(([carrier, stats]) => (
                  <tr key={carrier}>
                    <td className="col-name">{carrier}</td>
                    <td>{formatInt(stats?.new || 0)}</td>
                    <td>{formatInt(stats?.inTransit || 0)}</td>
                    <td>{formatInt(stats?.delivered || 0)}</td>
                    <td>
                      <StatusTag tone={(stats?.problem || 0) > 0 ? "danger" : "success"}>
                        {formatInt(stats?.problem || 0)}
                      </StatusTag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Немає даних по перевізниках"
            desc="Статистика за службами доставки зʼявиться після імпорту відправлень."
          />
        )}
      </div>
    </Panel>
  );
}

function SectionPayments({ payments = {}, loading = false }) {
  return (
    <Panel
      loading={loading}
      title="Оплати"
      subtitle="Передоплата, доплати та спірні платежі перед відвантаженням"
    >
      <div className="wallboard-grid-2">
        <KpiCard
          label="Очікує 25%"
          value={formatInt(payments.awaitingPrepay || 0)}
          icon="₴"
          variant="warning"
        />
        <KpiCard
          label="Очікує доплату"
          value={formatInt(payments.awaitingRest || 0)}
          icon="₴"
          variant="primary"
        />
        <KpiCard
          label="Спори"
          value={formatInt(payments.disputes || 0)}
          icon="!"
          variant="danger"
        />
        <KpiCard
          label="Середній чек"
          value={`${formatInt(payments.avgCheckUAH || 0)} ₴`}
          icon="◌"
          variant="success"
        />
      </div>
    </Panel>
  );
}

function SectionServices({ services = {}, loading = false }) {
  const downCount = SERVICE_ROWS.reduce((count, [, key]) => {
    const status = String(services[key] || "").toLowerCase();
    return status && status !== "up" && status !== "ok" && status !== "healthy" ? count + 1 : count;
  }, 0);

  return (
    <Panel
      loading={loading}
      title="Сервіси та здоровʼя"
      subtitle="Стан ключових систем"
      footer={<span className="panel-footer-meta">Проблемних сервісів: {formatInt(downCount)}</span>}
    >
      <div className="wboard-table-wrap">
        <table className="wboard-table">
          <thead>
            <tr>
              <th>Сервіс</th>
              <th>Статус</th>
            </tr>
          </thead>

          <tbody>
            {SERVICE_ROWS.map(([name, key]) => (
              <tr key={key}>
                <td className="col-name">{name}</td>
                <td>
                  <StatusTag tone={getServiceTone(services[key])}>
                    {getServiceLabel(services[key])}
                  </StatusTag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function SectionIndexer({ idx = {}, loading = false }) {
  return (
    <Panel
      loading={loading}
      title="Пошуковий індекс"
      subtitle="Стан індексації каталогу та швидкість оновлення"
    >
      <div className="wallboard-grid-2">
        <KpiCard label="Беклог" value={formatInt(idx.backlog || 0)} icon="◦" variant="warning" />
        <KpiCard
          label="Швидкість"
          value={`${formatInt(idx.ratePerMin || 0)}/хв`}
          icon="→"
          variant="success"
        />
        <KpiCard label="Шарди" value={formatInt(idx.shards || 1)} icon="≡" variant="primary" />
        <KpiCard
          label="Останнє оновлення"
          value={formatDateTime(idx.lastIndexedAt)}
          icon="◷"
          variant="info"
        />
      </div>
    </Panel>
  );
}

function SectionIngester({ ing = {}, loading = false }) {
  const batches = Array.isArray(ing.batches) ? ing.batches : [];

  return (
    <Panel
      loading={loading}
      title="Імпорт"
      subtitle="CSV, медіа, нормалізація та результат останніх пакетів"
    >
      {batches.length ? (
        <div className="wboard-table-wrap">
          <table className="wboard-table">
            <thead>
              <tr>
                <th>Пакет</th>
                <th>Рядків</th>
                <th>Успішно</th>
                <th>Помилки</th>
                <th>Тривалість</th>
              </tr>
            </thead>

            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id}>
                  <td className="col-id">{batch.id || "—"}</td>
                  <td>{formatInt(batch.rows || 0)}</td>
                  <td>{formatInt(batch.ok || 0)}</td>
                  <td>{formatInt(batch.fail || 0)}</td>
                  <td>{batch.duration || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="Пакетів імпорту поки немає"
          desc="Останні завантаження CSV і медіа зʼявляться тут після запуску імпортера."
        />
      )}

      <div className="wallboard-grid-4 wallboard-stack-lg">
        <KpiCard
          label="Беклог медіа"
          value={formatInt(ing.mediaBacklog || 0)}
          icon="◫"
          variant="warning"
        />
        <KpiCard
          label="Трансформацій / хв"
          value={formatInt(ing.mediaRatePerMin || 0)}
          icon="⇄"
          variant="success"
        />
        <KpiCard
          label="Помилки за 1 год"
          value={formatInt(ing.errors1h || 0)}
          icon="!"
          variant="danger"
        />
        <KpiCard
          label="Версія pricing.yml"
          value={ing.pricingVersion || "—"}
          icon="⌘"
          variant="primary"
        />
      </div>
    </Panel>
  );
}

function SectionWebhooks({ wh = {}, loading = false }) {
  const providers = wh.providers && typeof wh.providers === "object" ? wh.providers : {};
  const items = Object.entries(providers);

  return (
    <Panel
      loading={loading}
      title="Вебхуки"
      subtitle="Платіжні провайдери, перевізники та останні помилки"
    >
      {items.length ? (
        <div className="wboard-table-wrap">
          <table className="wboard-table">
            <thead>
              <tr>
                <th>Джерело</th>
                <th>Успішність</th>
                <th>Збої за 5 хв</th>
                <th>Остання помилка</th>
              </tr>
            </thead>

            <tbody>
              {items.map(([name, value]) => (
                <tr key={name}>
                  <td className="col-name">{name}</td>
                  <td>{formatPercent(value?.successRate || 0)}</td>
                  <td>
                    <StatusTag tone={(value?.failed5m || 0) > 0 ? "warning" : "success"}>
                      {formatInt(value?.failed5m || 0)}
                    </StatusTag>
                  </td>
                  <td className="col-sub">{value?.lastError || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="Немає даних по вебхуках"
          desc="Після першої активності провайдерів тут зʼявиться статистика доставок і помилок."
        />
      )}
    </Panel>
  );
}

function SectionAlerts({ alerts = [], loading = false }) {
  return (
    <Panel loading={loading} title="Оповіщення" subtitle="Останні 10 подій" flush>
      {alerts.length ? (
        <div className="activity-feed">
          {alerts.slice(0, 10).map((alert, index) => (
            <div
              key={`${alert.ts || "alert"}-${index}`}
              className={`activity-item${index === 0 ? " activity-item--unread" : ""}`}
            >
              <div className="activity-avatar" aria-hidden="true">
                {getAlertLabel(alert.level).slice(0, 1)}
              </div>

              <div className="activity-content">
                <div className="activity-name">{alert.title || "Без назви"}</div>
                <div className="activity-desc">
                  <strong>{getAlertLabel(alert.level)}</strong>
                  {alert.message ? ` • ${alert.message}` : " • Системне сповіщення"}
                </div>
              </div>

              <div className="activity-time">
                <StatusTag tone={getAlertTone(alert.level)}>{formatDateTime(alert.ts)}</StatusTag>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Немає активних оповіщень"
          desc="Коли система зафіксує подію або проблему, вона зʼявиться тут."
        />
      )}
    </Panel>
  );
}

function TopSummary({ prints, stats, alertsCount }) {
  return (
    <div className="kpi-grid">
      <KpiCard
        label="Друкується зараз"
        value={formatInt(prints.stats?.printing || 0)}
        context={`Активних завдань: ${formatInt(prints.jobs?.length || 0)}`}
        icon="◔"
        variant="success"
      />
      <KpiCard
        label="У черзі"
        value={formatInt(prints.stats?.queued || 0)}
        context={`Черга друку: ${formatInt(stats.queues?.prints?.ready || 0)}`}
        icon="≡"
        variant="warning"
      />
      <KpiCard
        label="Завершено"
        value={formatInt(prints.stats?.done || 0)}
        context={`Доставлено: ${formatInt(stats.logistics?.delivered || 0)}`}
        icon="✓"
        variant="primary"
      />
      <KpiCard
        label="Проблеми / алерти"
        value={formatInt(alertsCount + asNumber(stats.logistics?.problem, 0))}
        context={`Оповіщень: ${formatInt(alertsCount)}`}
        icon="!"
        variant={alertsCount > 0 || asNumber(stats.logistics?.problem, 0) > 0 ? "danger" : "info"}
      />
    </div>
  );
}

export default function Board() {
  const [ops, setOps] = useState(DEFAULT_OPS);
  const [prints, setPrints] = useState(DEFAULT_PRINTS);
  const [printerMonitor, setPrinterMonitor] = useState(DEFAULT_PRINTER_MONITOR);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(new Date());

  useEffect(() => {
    let isMounted = true;

    Promise.allSettled([api.opsOverview(), api.printsOverview()])
      .then(([opsResult, printsResult]) => {
        if (!isMounted) return;

        if (opsResult.status === "fulfilled") {
          setOps((current) => mergeOps(current, opsResult.value));
        }

        if (printsResult.status === "fulfilled") {
          setPrints((current) => mergePrints(current, printsResult.value));
        }

        const errors = [opsResult, printsResult]
          .filter((result) => result.status === "rejected")
          .map((result) =>
            result.reason instanceof Error ? result.reason.message : "Помилка завантаження"
          );

        setLoadError(errors.join(" • "));
        setUpdatedAt(new Date());
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const loadPrinterStatuses = async () => {
      if (inFlight) return;

      inFlight = true;

      try {
        const data = await fetchPrinterStatuses();

        if (cancelled) return;

        setPrinterMonitor({
          printers: Array.isArray(data.printers) ? data.printers : [],
          error: "",
        });

        setUpdatedAt(new Date());
      } catch (error) {
        if (cancelled) return;

        setPrinterMonitor((current) => ({
          ...current,
          error:
            error instanceof Error
              ? error.message
              : "Не вдалося отримати статус принтерів",
        }));
      } finally {
        inFlight = false;
      }
    };

    loadPrinterStatuses();

    const timer = window.setInterval(loadPrinterStatuses, PRINTER_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const handleSSEEvent = useCallback((event = {}) => {
    const data = event.payload || event.data || {};

    setUpdatedAt(new Date());

    if (event.type === "print.progress") {
      setPrints((current) => ({
        ...current,
        jobs: current.jobs.map((job) =>
          job.id === event.entity_id
            ? {
                ...job,
                progress: data.progress ?? job.progress,
                eta: data.eta ?? job.eta,
              }
            : job
        ),
      }));

      return;
    }

    if (event.type === "printer.state") {
      setPrints((current) => ({
        ...current,
        printers: current.printers.map((printer) =>
          printer.id === event.entity_id
            ? {
                ...printer,
                state: data.state ?? printer.state,
              }
            : printer
        ),
      }));

      setPrinterMonitor((current) => ({
        ...current,
        printers: current.printers.map((printer) =>
          printer.id === event.entity_id
            ? {
                ...printer,
                status: data.state ?? printer.status,
                state: data.state ?? printer.state,
              }
            : printer
        ),
      }));

      return;
    }

    if (event.domain === "prints" || event.domain === "print") {
      setPrints((current) => mergePrints(current, data));
      return;
    }

    if (event.domain === "ops") {
      setOps((current) => mergeOps(current, data));
    }
  }, []);

  const sseOptions = useMemo(
    () => ({
      onEvent: handleSSEEvent,
    }),
    [handleSSEEvent]
  );

  useSSE("/api/events/stream?topics=orders,prints,shipments,ops", sseOptions);

  const stats = ops.stats || {};
  const alerts = Array.isArray(stats.alerts) ? stats.alerts : [];

  return (
    <div className="wallboard">
      <HeroHeader updatedAt={updatedAt} loading={loading} />

      {loading ? (
        <div className="alert-strip alert-strip--info">
          <div className="alert-strip-icon" aria-hidden="true">
            ⟳
          </div>
          <div className="alert-strip-text">Завантажую зведення операцій та друкарської ферми…</div>
        </div>
      ) : null}

      {loadError ? (
        <div className="alert-strip alert-strip--danger">
          <div className="alert-strip-icon" aria-hidden="true">
            !
          </div>
          <div className="alert-strip-text">{loadError}</div>
        </div>
      ) : null}

      <TopSummary prints={prints} stats={stats} alertsCount={alerts.length} />

      <div className="wallboard-sections">
        <div className="wallboard-row">
          <SectionPrintFarm
            printers={prints.printers}
            jobs={prints.jobs}
            livePrinters={printerMonitor.printers}
            monitorError={printerMonitor.error}
            loading={loading}
          />
          <SectionAlerts alerts={alerts} loading={loading} />
        </div>

        <div className="wallboard-row">
          <SectionOrders data={stats} loading={loading} />
          <SectionServices services={stats.services} loading={loading} />
        </div>

        <div className="wallboard-row">
          <SectionQueues queues={stats.queues} loading={loading} />
          <SectionPayments payments={stats.payments} loading={loading} />
        </div>

        <div className="wallboard-row">
          <SectionLogistics logistics={stats.logistics} loading={loading} />
          <SectionMaterials materials={stats.materials} loading={loading} />
        </div>

        <div className="wallboard-row">
          <SectionWebhooks wh={stats.webhooks} loading={loading} />
          <SectionIndexer idx={stats.indexer} loading={loading} />
        </div>

        <SectionIngester ing={stats.ingester} loading={loading} />
      </div>
    </div>
  );
}