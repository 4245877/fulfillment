import React, { memo, useCallback, useEffect, useMemo, useState } from "react";

import { apiWB as api } from "../api/wallboardApi.js";
import { useSSE } from "../hooks/useSSE.js";

import "../styles/wallboard.css";

const DEFAULT_OPS = {
  stats: {
    orders: {},
    payments: {},
    logistics: {},
    materials: {},
    queues: {},
    services: {},
    indexer: {},
    webhooks: {},
    ingester: {},
    alerts: [],
  },
};
const DEFAULT_PRINTS = { printers: [], jobs: [], stats: {} };

const DEFAULT_BACKUP_STATUS = {
  status: "unknown",
  step: null,
  message: "Статус резервного копіювання ще не завантажено",
  run_id: null,
  run_dir: null,
  log_file: null,
  updated_at: null,
};

const BACKUP_POLL_INTERVAL_MS = 10000;
const LAG_WARNING_MS = 5000;
const LAG_DANGER_MS = 60000;

const ORDER_STAGES = [
  { key: "New", label: "Нові", icon: "+", variant: "info" },
  { key: "Accepted", label: "Прийнято", icon: "✓", variant: "primary" },
  {
    key: "PrePrintCheck",
    label: "Перевірка перед друком",
    icon: "◌",
    variant: "primary",
  },
  { key: "Queued", label: "У черзі", icon: "≡", variant: "warning" },
  { key: "Printing", label: "Друкується", icon: "◔", variant: "success" },
  { key: "PostProcess", label: "Постобробка", icon: "◌", variant: "primary" },
  { key: "Packaging", label: "Пакування", icon: "□", variant: "primary" },
  { key: "Shipment", label: "Відправлення", icon: "→", variant: "primary" },
  { key: "Pickup", label: "Самовивіз", icon: "⌂", variant: "info" },
  { key: "Delivered", label: "Доставлено", icon: "✓", variant: "success" },
  { key: "Issued", label: "Видано", icon: "✓", variant: "success" },
  { key: "Problem", label: "Проблема", icon: "!", variant: "danger" },
  { key: "Cancelled", label: "Скасовано", icon: "×", variant: "info" },
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

function normalizeBackupStatus(value, fallback = DEFAULT_BACKUP_STATUS) {
  const payload = isPlainObject(value) ? value : {};
  const progress = isPlainObject(payload.progress) ? payload.progress : payload;
  const raw = isPlainObject(payload.raw) ? payload.raw : {};

  return {
    ...DEFAULT_BACKUP_STATUS,
    ...fallback,
    status: raw.status ?? progress.status ?? fallback.status,
    step: raw.step ?? progress.step ?? progress.stage ?? fallback.step,
    message: raw.message ?? progress.message ?? fallback.message,
    run_id:
      raw.run_id ??
      raw.runId ??
      progress.run_id ??
      progress.runId ??
      fallback.run_id,
    run_dir:
      raw.run_dir ??
      raw.runDir ??
      progress.run_dir ??
      progress.runDir ??
      fallback.run_dir,
    log_file:
      raw.log_file ??
      raw.logFile ??
      progress.log_file ??
      progress.logFile ??
      fallback.log_file,
    updated_at:
      raw.updated_at ??
      raw.updatedAt ??
      progress.updated_at ??
      progress.updatedAt ??
      fallback.updated_at,
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

// Single source of truth for the "Стан сервісів" panel so that the tag colour,
// the Ukrainian label and the "problem" counter never drift apart.
function describeService(status) {
  const v = String(status || "").trim().toLowerCase();

  if (!v || v === "unknown")
    return { tone: "primary", label: "Невідомо", problem: false };
  if (v === "up" || v === "ok" || v === "healthy")
    return { tone: "success", label: "Працює", problem: false };
  if (v === "degraded" || v === "warning" || v === "warn")
    return { tone: "warning", label: "Частково", problem: false };
  if (v === "down" || v === "offline" || v === "unreachable")
    return { tone: "danger", label: "Недоступний", problem: true };

  // Any other value (error, failed, timeout, …) is an unhealthy state: keep it
  // red and counted, but never leak the raw English token into the UI.
  return { tone: "danger", label: "Помилка", problem: true };
}

function getBackupTone(status) {
  const v = String(status || "").toLowerCase();

  if (v === "success") return "success";
  if (v === "running" || v === "queued") return "warning";
  if (v === "failed" || v === "error") return "danger";
  if (v === "skipped") return "warning";

  return "primary";
}

function getBackupStatusLabel(status) {
  const v = String(status || "").toLowerCase();

  if (v === "success") return "Готово";
  if (v === "running") return "Виконується";
  if (v === "queued") return "У черзі";
  if (v === "idle") return "Очікування";
  if (v === "failed" || v === "error") return "Помилка";
  if (v === "skipped") return "Пропущено";

  return "Невідомо";
}

function getBackupStepLabel(step) {
  const labels = {
    preflight: "Перевірка умов",
    preparing: "Підготовка",
    database: "База даних",
    files: "Файли",
    verifying: "Перевірка",
    uploading: "Копіювання",
    queued: "У черзі",
    postgres: "PostgreSQL",
    uploads: "Uploads",
    minio: "MinIO",
    ingester: "Ingester data",
    stl_large: "STL/3MF large",
    stl_small: "STL/3MF small",
    config: "Конфігурація",
    manifest: "Manifest",
    checksum: "SHA256",
    remote: "Копіювання на ПК",
    retention: "Очищення старих копій",
    done: "Готово",
    error: "Помилка",
    lock: "Вже виконується",
  };

  return labels[step] || (step ? String(step) : "—");
}

function getBackupAgeHours(updatedAt) {
  if (!updatedAt) return null;

  const date = new Date(updatedAt);

  if (Number.isNaN(date.getTime())) return null;

  return Math.max(0, (Date.now() - date.getTime()) / 36e5);
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
    <section
      className={`panel${loading ? " panel-loading" : ""}`}
      aria-busy={loading || undefined}
    >
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

      {loading ? <span className="panel-loading-spinner" aria-hidden="true" /> : null}

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

function HeroHeader({ updatedAt, loading, hasError }) {
  // Tick locally so the per-second clock only re-renders this header,
  // not the entire Board tree.
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);

    return () => window.clearInterval(timer);
  }, []);

  const statusTone = hasError ? "danger" : loading ? "warning" : "success";
  const statusText = hasError
    ? "Є проблеми із синхронізацією"
    : loading
      ? "Оновлення даних"
      : "Синхронізація активна";

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
          <div className="wallboard-hero-date">{formatHeroDate(currentTime)}</div>
          <div className="wallboard-hero-time">{formatHeaderTime(currentTime)}</div>
          <div
            className={`wallboard-hero-status wallboard-hero-status--${statusTone}`}
          >
            <span className="wallboard-hero-status-dot" aria-hidden="true" />
            {statusText}
          </div>
          <div className="wallboard-hero-updated">
            Дані оновлено о {formatHeaderTime(updatedAt)}
          </div>
        </div>
      </div>
    </header>
  );
}

const SectionOrders = memo(function SectionOrders({ data = {}, loading = false }) {
  const orders = data.orders || {};
  const total = ORDER_STAGES.reduce(
    (sum, { key }) => sum + asNumber(orders[key], 0),
    0
  );

  return (
    <Panel
      loading={loading}
      title="Замовлення — конвеєр"
      subtitle="Кількість замовлень у кожному поточному статусі"
      footer={<span className="panel-footer-meta">Усього замовлень: {formatInt(total)}</span>}
    >
      <div className="kpi-grid kpi-grid--orders">
        {ORDER_STAGES.map(({ key, label, icon, variant }) => (
          <KpiCard
            key={key}
            label={label}
            value={formatInt(orders[key] ?? 0)}
            icon={icon}
            variant={orders[key] ? variant : "info"}
          />
        ))}
      </div>
    </Panel>
  );
});

const SectionQueues = memo(function SectionQueues({ queues = {}, loading = false }) {
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
});

const SectionMaterials = memo(function SectionMaterials({ materials = {}, loading = false }) {
  const stock = Array.isArray(materials.stock) ? materials.stock : [];
  const low = Array.isArray(materials.low) ? materials.low : [];

  return (
    <Panel
      loading={loading}
      title="Склад пластику"
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
                            ? "Критично"
                            : status === "low"
                              ? "Низький"
                              : "Норма"}
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
});

const SectionLogistics = memo(function SectionLogistics({ logistics = {}, loading = false }) {
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
            title="Немає даних про перевізників"
            desc="Статистика за службами доставки зʼявиться після імпорту відправлень."
          />
        )}
      </div>
    </Panel>
  );
});

const SectionPayments = memo(function SectionPayments({ payments = {}, loading = false }) {
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
});

const SectionServices = memo(function SectionServices({ services = {}, loading = false }) {
  const rows = SERVICE_ROWS.map(([name, key]) => ({
    name,
    key,
    ...describeService(services[key]),
  }));
  const downCount = rows.reduce((count, row) => count + (row.problem ? 1 : 0), 0);

  return (
    <Panel
      loading={loading}
      title="Стан сервісів"
      subtitle="Доступність ключових систем"
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
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="col-name">{row.name}</td>
                <td>
                  <StatusTag tone={row.tone}>{row.label}</StatusTag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
});

const SectionBackups = memo(function SectionBackups({ backup = DEFAULT_BACKUP_STATUS, loading = false }) {
  const ageHours = getBackupAgeHours(backup.updated_at);
  const isOld = ageHours != null && ageHours > 30;
  const statusTone = isOld && backup.status === "success" ? "warning" : getBackupTone(backup.status);

  return (
    <Panel
      loading={loading}
      title="Резервні копії"
      subtitle="Останній стан backup.sh на основному сервері"
      footer={
        <span className="panel-footer-meta">
          Оновлено: {formatDateTime(backup.updated_at)}
        </span>
      }
    >
      <div className="wallboard-grid-2">
        <KpiCard
          label="Статус"
          value={getBackupStatusLabel(backup.status)}
          context={backup.message || "—"}
          icon="◷"
          variant={statusTone}
        />

        <KpiCard
          label="Етап"
          value={getBackupStepLabel(backup.step)}
          context={backup.run_id ? `ID запуску: ${backup.run_id}` : "ID запуску ще немає"}
          icon="≡"
          variant="primary"
        />

        <KpiCard
          label="Вік статусу"
          value={ageHours == null ? "—" : `${formatFixed(ageHours, ageHours < 10 ? 1 : 0)} год`}
          context={isOld ? "Статус давно не оновлювався" : "Статус актуальний"}
          icon="◌"
          variant={isOld ? "warning" : "info"}
        />

        <KpiCard
          label="Перевірка"
          value={backup.status === "success" ? "OK" : backup.status === "running" ? "У процесі" : "—"}
          context="SHA256, дамп PostgreSQL і tar-архіви"
          icon={backup.status === "success" ? "✓" : "!"}
          variant={backup.status === "success" ? "success" : "info"}
        />
      </div>

      <div className="wallboard-stack-lg">
        <div className="wboard-table-wrap">
          <table className="wboard-table">
            <tbody>
              <tr>
                <td className="col-name">Каталог</td>
                <td className="col-sub">{backup.run_dir || "—"}</td>
              </tr>

              <tr>
                <td className="col-name">Лог</td>
                <td className="col-sub">{backup.log_file || "—"}</td>
              </tr>

              <tr>
                <td className="col-name">Вміст</td>
                <td className="col-sub">
                  PostgreSQL, uploads, MinIO, ingester data, STL/3MF, config
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <StatusTag tone={statusTone}>
          {isOld ? "Потребує уваги" : getBackupStatusLabel(backup.status)}
        </StatusTag>
      </div>
    </Panel>
  );
});

const SectionIndexer = memo(function SectionIndexer({ idx = {}, loading = false }) {
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
});

const SectionIngester = memo(function SectionIngester({ ing = {}, loading = false }) {
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
          label="Трансформацій за хвилину"
          value={formatInt(ing.mediaRatePerMin || 0)}
          icon="⇄"
          variant="success"
        />
        <KpiCard
          label="Помилки за годину"
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
});

const SectionWebhooks = memo(function SectionWebhooks({ wh = {}, loading = false }) {
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
});

const SectionAlerts = memo(function SectionAlerts({ alerts = [], loading = false }) {
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
});

const TopSummary = memo(function TopSummary({ prints, stats, alertsCount }) {
  const jobs = Array.isArray(prints.jobs) ? prints.jobs : [];
  const orderProblems = asNumber(stats.orders?.Problem, 0);
  const logisticsProblems = asNumber(stats.logistics?.problem, 0);
  const problemsCount = alertsCount + orderProblems + logisticsProblems;

  const activeJobs = jobs.filter((job) => {
    const status = String(job.status || job.state || "").toLowerCase();

    return ["printing", "running", "queued", "paused"].includes(status);
  });

  return (
    <div className="kpi-grid">
      <KpiCard
        label="Друкується зараз"
        value={formatInt(prints.stats?.printing || 0)}
        context={`Активних завдань: ${formatInt(activeJobs.length)}`}
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
        label="Проблеми й оповіщення"
        value={formatInt(problemsCount)}
        context={`Проблемних замовлень: ${formatInt(orderProblems)}`}
        icon="!"
        variant={problemsCount > 0 ? "danger" : "info"}
      />
    </div>
  );
});

export default function Board() {
  const [ops, setOps] = useState(DEFAULT_OPS);
  const [prints, setPrints] = useState(DEFAULT_PRINTS);
  const [backupStatus, setBackupStatus] = useState(DEFAULT_BACKUP_STATUS);
  const [backupError, setBackupError] = useState("");
  const [backupLoading, setBackupLoading] = useState(true);
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

    const loadBackupStatus = async () => {
      if (inFlight) return;

      inFlight = true;

      try {
        const data = await api.backupStatus();

        if (cancelled) return;

        setBackupStatus(normalizeBackupStatus(data));
        setBackupError("");
        setUpdatedAt(new Date());
      } catch (error) {
        if (cancelled) return;

        setBackupError(
          error instanceof Error
            ? error.message
            : "Не вдалося отримати статус резервного копіювання"
        );
      } finally {
        inFlight = false;

        if (!cancelled) {
          setBackupLoading(false);
        }
      }
    };

    loadBackupStatus();

    const timer = window.setInterval(loadBackupStatus, BACKUP_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const handleSSEEvent = useCallback((event = {}) => {
    const data = event.payload || event.data || {};

    setUpdatedAt(new Date());

    if (event.type === "print.progress") {
      setPrints((current) => {
        const jobs = Array.isArray(current.jobs) ? current.jobs : [];

        return {
          ...current,
          jobs: jobs.map((job) =>
            job.id === event.entity_id
              ? {
                  ...job,
                  progress: data.progress ?? job.progress,
                  eta: data.eta ?? job.eta,
                }
              : job
          ),
        };
      });

      return;
    }

    if (event.type === "printer.state") {
      setPrints((current) => {
        const printers = Array.isArray(current.printers) ? current.printers : [];

        return {
          ...current,
          printers: printers.map((printer) =>
            printer.id === event.entity_id
              ? {
                  ...printer,
                  state: data.state ?? printer.state,
                }
              : printer
          ),
        };
      });

      return;
    }

    if (event.domain === "prints" || event.domain === "print") {
      setPrints((current) => mergePrints(current, data));
      return;
    }

    if (event.domain === "backup" || event.type === "backup.status") {
      setBackupStatus((current) =>
        normalizeBackupStatus(
          data,
          event.type === "backup.status" ? DEFAULT_BACKUP_STATUS : current
        )
      );
      setBackupError("");
      setBackupLoading(false);
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

  useSSE("/api/events/stream?topics=orders,prints,shipments,ops,backup", sseOptions);

  const stats = ops.stats || {};
  const alerts = Array.isArray(stats.alerts) ? stats.alerts : [];

  return (
    <div className="wallboard">
      <HeroHeader
        updatedAt={updatedAt}
        loading={loading || backupLoading}
        hasError={Boolean(loadError || backupError)}
      />

      {loading ? (
        <div
          className="alert-strip alert-strip--info"
          role="status"
          aria-live="polite"
        >
          <div className="alert-strip-icon" aria-hidden="true">
            ⟳
          </div>
          <div className="alert-strip-text">Завантажую зведення операцій та друкарської ферми…</div>
        </div>
      ) : null}

      {loadError ? (
        <div className="alert-strip alert-strip--danger" role="alert">
          <div className="alert-strip-icon" aria-hidden="true">
            !
          </div>
          <div className="alert-strip-text">{loadError}</div>
        </div>
      ) : null}

      {backupError ? (
        <div className="alert-strip alert-strip--warning" role="alert">
          <div className="alert-strip-icon" aria-hidden="true">
            !
          </div>
          <div className="alert-strip-text">
            Не вдалося отримати статус резервного копіювання: {backupError}
          </div>
        </div>
      ) : null}

      <TopSummary prints={prints} stats={stats} alertsCount={alerts.length} />

      <div className="wallboard-sections">
        <div className="wallboard-row">
          <SectionOrders data={stats} loading={loading} />
          <SectionAlerts alerts={alerts} loading={loading} />
        </div>

        <div className="wallboard-row">
          <SectionServices services={stats.services} loading={loading} />
          <SectionBackups backup={backupStatus} loading={backupLoading} />
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

        <div className="wallboard-row wallboard-row--full">
          <SectionIngester ing={stats.ingester} loading={loading} />
        </div>
      </div>
    </div>
  );
}