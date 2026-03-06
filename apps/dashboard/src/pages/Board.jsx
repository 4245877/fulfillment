import React, { useEffect, useMemo, useState } from "react";

import { apiWB as api } from "../api/wallboardApi.js";
import { useSSE } from "../hooks/useSSE.js";

import "../styles/wallboard.css";

const DEFAULT_OPS = { stats: {} };
const DEFAULT_PRINTS = { printers: [], jobs: [], stats: {} };

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

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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

function normalizeProgress(value) {
  return normalizePercent(value);
}

function formatPercent(value) {
  return `${Math.round(normalizePercent(value))}%`;
}

function getLagTone(value) {
  const ms = asNumber(value, 0);
  if (ms > 60000) return "danger";
  if (ms > 5000) return "warn";
  return "ok";
}

function getAlertTone(level) {
  const v = String(level || "").toLowerCase();
  if (v === "error") return "danger";
  if (v === "warn" || v === "warning") return "warn";
  if (v === "ok" || v === "success") return "ok";
  return "info";
}

function getPrinterTone(state) {
  const v = String(state || "").toLowerCase();
  if (v === "printing" || v === "ready") return "ok";
  if (v === "paused" || v === "maintenance") return "warn";
  if (v === "error" || v === "offline") return "danger";
  return "info";
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
  if (v === "up" || v === "ok" || v === "healthy") return "ok";
  if (v === "degraded" || v === "warning") return "warn";
  return "danger";
}

function getServiceLabel(status) {
  const v = String(status || "").toLowerCase();
  if (v === "up" || v === "ok" || v === "healthy") return "Працює";
  if (v === "degraded" || v === "warning") return "Частково";
  if (v === "down") return "Недоступний";
  return status ? String(status) : "Недоступний";
}

function mergeOps(current, next) {
  if (!next || typeof next !== "object") return current;

  return {
    ...current,
    ...next,
    stats: {
      ...(current.stats || {}),
      ...(next.stats || {}),
    },
  };
}

function mergePrints(current, next) {
  if (!next || typeof next !== "object") return current;

  return {
    ...current,
    ...next,
    stats: {
      ...(current.stats || {}),
      ...(next.stats || {}),
    },
    printers: Array.isArray(next.printers) ? next.printers : current.printers,
    jobs: Array.isArray(next.jobs) ? next.jobs : current.jobs,
  };
}

function Badge({ children, tone = "info" }) {
  return <span className={`wb-badge wb-badge--${tone}`}>{children}</span>;
}

function WallboardWidget({ title, sub, children }) {
  return (
    <section className="wb-widget">
      <div className="wb-widgetHead">
        <h2 className="wb-widgetTitle">{title}</h2>
        {sub ? <p className="wb-widgetSub">{sub}</p> : null}
      </div>
      <div className="wb-widgetBody">{children}</div>
    </section>
  );
}

function ProgressBar({ value }) {
  const percent = normalizeProgress(value);

  return (
    <div className="wb-row wb-row--tight">
      <div
        className="wb-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-label={`Прогрес ${Math.round(percent)}%`}
      >
        <span className="wb-progressFill" style={{ width: `${percent}%` }} />
      </div>
      <span className="wb-small wb-listMeta">{Math.round(percent)}%</span>
    </div>
  );
}

function Header({ stats, updatedAt }) {
  return (
    <header className="wb-header">
      <div className="wb-headerTop">
        <div className="wb-headerTitleBlock">
          <h1 className="wb-headerTitle">DRUKARNYA • Операційна панель</h1>
          <p className="wb-headerMeta">Оновлено: {formatHeaderTime(updatedAt)}</p>
        </div>

        <div className="wb-row">
          <Badge tone="ok">Друк: {formatInt(stats?.printing ?? 0)}</Badge>
          <Badge tone="info">У черзі: {formatInt(stats?.queued ?? 0)}</Badge>
          <Badge tone="ok">Готово: {formatInt(stats?.done ?? 0)}</Badge>
        </div>
      </div>
    </header>
  );
}

function SectionOrders({ data = {} }) {
  const orders = data.orders || {};

  return (
    <WallboardWidget
      title="Замовлення — конвеєр"
      sub="Кількість замовлень на кожному етапі"
    >
      <div className="wb-kpi">
        {ORDER_STAGES.map(([key, label]) => (
          <div key={key} className="wb-kpiBox">
            <div className="wb-kpiLabel">{label}</div>
            <div className="wb-kpiValue">{formatInt(orders[key] || 0)}</div>
          </div>
        ))}
      </div>
    </WallboardWidget>
  );
}

function SectionPrintFarm({ printers = [], jobs = [] }) {
  return (
    <WallboardWidget
      title="3D-ферма — принтери та завдання"
      sub="Стан обладнання та прогрес активних робіт"
    >
      <div className="wb-list">
        {printers.map((printer) => (
          <div key={printer.id} className="wb-listRow">
            <div className="wb-listPrimary">
              <div className="wb-printerName">{printer.name || "Принтер без назви"}</div>
              <div className="wb-small">
                {printer.model || "Модель не вказана"}
                {printer.nozzle ? ` • Сопло ${printer.nozzle}` : ""}
              </div>
            </div>

            <Badge tone={getPrinterTone(printer.state)}>
              {getPrinterStateLabel(printer.state)}
            </Badge>

            <span className="wb-small wb-listMeta">
              {printer.material_color || "Матеріал не вказано"}
            </span>
          </div>
        ))}

        {!printers.length && <div className="wb-small">Дані про принтери відсутні.</div>}
      </div>

      <div className="wb-tableWrap">
        <table className="wb-table wb-table--jobs">
          <colgroup>
            <col className="wb-col-order" />
            <col className="wb-col-sku" />
            <col className="wb-col-printer" />
            <col className="wb-col-prog" />
            <col className="wb-col-eta" />
          </colgroup>
          <thead>
            <tr>
              <th>Замовлення</th>
              <th>SKU × кількість</th>
              <th>Принтер</th>
              <th>Прогрес</th>
              <th>ETA</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id}>
                <td>{job.order_number || "—"}</td>
                <td>
                  {(job.sku || "—") + " ×" + formatInt(job.qty || 0)}
                </td>
                <td>{job.printer_name || "—"}</td>
                <td>
                  <ProgressBar value={job.progress || 0} />
                </td>
                <td>{job.eta || "—"}</td>
              </tr>
            ))}

            {!jobs.length && (
              <tr>
                <td colSpan={5} className="wb-small">
                  Немає активних завдань.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </WallboardWidget>
  );
}

function SectionQueues({ q = {} }) {
  const rows = QUEUE_ROWS.map(({ key, label, readyKey, runningKey }) => ({
    key,
    label,
    ready: q[key]?.[readyKey] ?? 0,
    running: runningKey ? q[key]?.[runningKey] ?? 0 : "—",
    lag: q[key]?.lagMs ?? 0,
  }));

  return (
    <WallboardWidget title="Черги та відставання" sub="Розмір черг і час затримки">
      <div className="wb-tableWrap">
        <table className="wb-table wb-table--queues">
          <colgroup>
            <col className="wb-col-name" />
            <col className="wb-col-ready" />
            <col className="wb-col-run" />
            <col className="wb-col-lag" />
          </colgroup>
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
                <td>{row.label}</td>
                <td>{formatInt(row.ready)}</td>
                <td>{typeof row.running === "number" ? formatInt(row.running) : row.running}</td>
                <td>
                  <Badge tone={getLagTone(row.lag)}>{formatLag(row.lag)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </WallboardWidget>
  );
}

function SectionMaterials({ m = {} }) {
  const low = Array.isArray(m.low) ? m.low : [];

  return (
    <WallboardWidget
      title="Матеріали"
      sub="Запаси філаменту, смоли та позиції з ризиком дефіциту"
    >
      <div className="wb-kpi">
        <div className="wb-kpiBox">
          <div className="wb-kpiLabel">Філамент</div>
          <div className="wb-kpiValue">{formatFixed(m.filamentKg ?? 0, 1)} кг</div>
        </div>

        <div className="wb-kpiBox">
          <div className="wb-kpiLabel">Смола</div>
          <div className="wb-kpiValue">{formatFixed(m.resinL ?? 0, 1)} л</div>
        </div>

        <div className="wb-kpiBox">
          <div className="wb-kpiLabel">Котушки в роботі</div>
          <div className="wb-kpiValue">{formatInt(m.reelsInUse ?? 0)}</div>
        </div>

        <div className="wb-kpiBox">
          <div className="wb-kpiLabel">Поріг дефіциту</div>
          <div className="wb-kpiValue">{formatFixed(m.lowThresholdKg ?? 1, 1)} кг</div>
        </div>
      </div>

      <div className="wb-list">
        {low.map((item, index) => (
          <div key={`${item.material || "material"}-${index}`} className="wb-listRow">
            <div className="wb-listPrimary">
              <div className="wb-small">{item.material || "Матеріал без назви"}</div>
            </div>
            <Badge tone="warn">{formatFixed(item.remainKg ?? 0, 1)} кг</Badge>
          </div>
        ))}

        {!low.length && <div className="wb-small">Дефіцитних матеріалів не виявлено.</div>}
      </div>
    </WallboardWidget>
  );
}

function SectionLogistics({ l = {} }) {
  const byCarrier = l.byCarrier && typeof l.byCarrier === "object" ? l.byCarrier : null;

  return (
    <WallboardWidget
      title="Логістика"
      sub="Статуси відправлень та розподіл за перевізниками"
    >
      <div className="wb-kpi">
        {LOGISTICS_STATUSES.map(([key, label]) => (
          <div key={key} className="wb-kpiBox">
            <div className="wb-kpiLabel">{label}</div>
            <div className="wb-kpiValue">{formatInt(l[key] || 0)}</div>
          </div>
        ))}
      </div>

      {byCarrier ? (
        <div className="wb-tableWrap">
          <table className="wb-table wb-table--logistics">
            <colgroup>
              <col className="wb-col-carrier" />
              <col className="wb-col-new" />
              <col className="wb-col-transit" />
              <col className="wb-col-delivered" />
              <col className="wb-col-problem" />
            </colgroup>
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
                  <td>{carrier}</td>
                  <td>{formatInt(stats?.new || 0)}</td>
                  <td>{formatInt(stats?.inTransit || 0)}</td>
                  <td>{formatInt(stats?.delivered || 0)}</td>
                  <td>{formatInt(stats?.problem || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="wb-small">Дані по перевізниках відсутні.</div>
      )}
    </WallboardWidget>
  );
}

function SectionPayments({ p = {} }) {
  return (
    <WallboardWidget
      title="Оплати"
      sub="Передоплата, доплати та спірні платежі перед відвантаженням"
    >
      <div className="wb-kpi">
        <div className="wb-kpiBox">
          <div className="wb-kpiLabel">Очікує 25%</div>
          <div className="wb-kpiValue">{formatInt(p.awaitingPrepay || 0)}</div>
        </div>

        <div className="wb-kpiBox">
          <div className="wb-kpiLabel">Очікує доплату</div>
          <div className="wb-kpiValue">{formatInt(p.awaitingRest || 0)}</div>
        </div>

        <div className="wb-kpiBox">
          <div className="wb-kpiLabel">Спори</div>
          <div className="wb-kpiValue">{formatInt(p.disputes || 0)}</div>
        </div>

        <div className="wb-kpiBox">
          <div className="wb-kpiLabel">Середній чек</div>
          <div className="wb-kpiValue">{formatInt(p.avgCheckUAH || 0)} ₴</div>
        </div>
      </div>
    </WallboardWidget>
  );
}

function SectionServices({ s = {} }) {
  const rows = [
    ["Shop API", s.shop],
    ["Fulfillment API", s.fulfillment],
    ["Printers Net", s.printers],
    ["PostgreSQL", s.db],
    ["Redis", s.redis],
    ["Search Indexer", s.indexer],
  ];

  return (
    <WallboardWidget title="Сервіси та здоровʼя" sub="Стан ключових систем">
      <div className="wb-tableWrap">
        <table className="wb-table wb-table--services">
          <colgroup>
            <col className="wb-col-service" />
            <col className="wb-col-status" />
          </colgroup>
          <thead>
            <tr>
              <th>Сервіс</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, value]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>
                  <Badge tone={getServiceTone(value)}>{getServiceLabel(value)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </WallboardWidget>
  );
}

function SectionIndexer({ idx = {} }) {
  return (
    <WallboardWidget
      title="Пошуковий індекс"
      sub="Стан індексації каталогу та швидкість оновлення"
    >
      <div className="wb-kpi">
        <div className="wb-kpiBox">
          <div className="wb-kpiLabel">Беклог</div>
          <div className="wb-kpiValue">{formatInt(idx.backlog || 0)}</div>
        </div>

        <div className="wb-kpiBox">
          <div className="wb-kpiLabel">Останнє оновлення</div>
          <div className="wb-kpiValue">{formatDateTime(idx.lastIndexedAt)}</div>
        </div>

        <div className="wb-kpiBox">
          <div className="wb-kpiLabel">Швидкість</div>
          <div className="wb-kpiValue">{formatInt(idx.ratePerMin || 0)}/хв</div>
        </div>

        <div className="wb-kpiBox">
          <div className="wb-kpiLabel">Шарди</div>
          <div className="wb-kpiValue">{formatInt(idx.shards || 1)}</div>
        </div>
      </div>
    </WallboardWidget>
  );
}

function SectionIngester({ ing = {} }) {
  const batches = Array.isArray(ing.batches) ? ing.batches : [];

  return (
    <WallboardWidget
      title="Імпорт"
      sub="CSV, медіа, нормалізація та результат останніх пакетів"
    >
      <div className="wb-tableWrap">
        <table className="wb-table wb-table--ingester">
          <colgroup>
            <col className="wb-col-batch" />
            <col className="wb-col-rows" />
            <col className="wb-col-ok" />
            <col className="wb-col-fail" />
            <col className="wb-col-duration" />
          </colgroup>
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
                <td>{batch.id || "—"}</td>
                <td>{formatInt(batch.rows || 0)}</td>
                <td>{formatInt(batch.ok || 0)}</td>
                <td>{formatInt(batch.fail || 0)}</td>
                <td>{batch.duration || "—"}</td>
              </tr>
            ))}

            {!batches.length && (
              <tr>
                <td colSpan={5} className="wb-small">
                  Немає даних про останні пакети.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="wb-kpi">
        <div className="wb-kpiBox">
          <div className="wb-kpiLabel">Беклог медіа</div>
          <div className="wb-kpiValue">{formatInt(ing.mediaBacklog || 0)}</div>
        </div>

        <div className="wb-kpiBox">
          <div className="wb-kpiLabel">Трансформацій / хв</div>
          <div className="wb-kpiValue">{formatInt(ing.mediaRatePerMin || 0)}</div>
        </div>

        <div className="wb-kpiBox">
          <div className="wb-kpiLabel">Помилки за 1 год</div>
          <div className="wb-kpiValue">{formatInt(ing.errors1h || 0)}</div>
        </div>

        <div className="wb-kpiBox">
          <div className="wb-kpiLabel">Версія pricing.yml</div>
          <div className="wb-kpiValue">{ing.pricingVersion || "—"}</div>
        </div>
      </div>
    </WallboardWidget>
  );
}

function SectionWebhooks({ wh = {} }) {
  const providers = wh.providers && typeof wh.providers === "object" ? wh.providers : {};
  const items = Object.entries(providers);

  return (
    <WallboardWidget
      title="Вебхуки"
      sub="Платіжні провайдери, перевізники та останні помилки"
    >
      <div className="wb-tableWrap">
        <table className="wb-table wb-table--webhooks">
          <colgroup>
            <col className="wb-col-source" />
            <col className="wb-col-rate" />
            <col className="wb-col-fail" />
            <col className="wb-col-error" />
          </colgroup>
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
                <td>{name}</td>
                <td>{formatPercent(value?.successRate || 0)}</td>
                <td>
                  <Badge tone={(value?.failed5m || 0) > 0 ? "warn" : "ok"}>
                    {formatInt(value?.failed5m || 0)}
                  </Badge>
                </td>
                <td className="wb-small">{value?.lastError || "—"}</td>
              </tr>
            ))}

            {!items.length && (
              <tr>
                <td colSpan={4} className="wb-small">
                  Дані по вебхуках відсутні.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </WallboardWidget>
  );
}

function SectionAlerts({ alerts = [] }) {
  return (
    <WallboardWidget title="Оповіщення" sub="Останні 10 подій">
      <div className="wb-list">
        {alerts.slice(0, 10).map((alert, index) => (
          <div key={`${alert.ts || "alert"}-${index}`} className="wb-listRow">
            <Badge tone={getAlertTone(alert.level)}>
              {String(alert.level || "info").toUpperCase()}
            </Badge>

            <div className="wb-listPrimary">
              <div className="wb-small">{alert.title || "Без назви"}</div>
            </div>

            <div className="wb-small wb-listMeta">{formatDateTime(alert.ts)}</div>
          </div>
        ))}

        {!alerts.length && <div className="wb-small">Немає активних оповіщень.</div>}
      </div>
    </WallboardWidget>
  );
}

export default function Board() {
  const [ops, setOps] = useState(DEFAULT_OPS);
  const [prints, setPrints] = useState(DEFAULT_PRINTS);
  const [loading, setLoading] = useState(true);
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

  useSSE("/api/events/stream?topics=orders,prints,shipments,ops", {
    onEvent: (event) => {
      setUpdatedAt(new Date());

      if (event.type === "print.progress") {
        setPrints((current) => ({
          ...current,
          jobs: current.jobs.map((job) =>
            job.id === event.entity_id
              ? {
                  ...job,
                  progress: event.data?.progress,
                  eta: event.data?.eta,
                }
              : job
          ),
        }));
      }

      if (event.type === "printer.state") {
        setPrints((current) => ({
          ...current,
          printers: current.printers.map((printer) =>
            printer.id === event.entity_id
              ? {
                  ...printer,
                  state: event.data?.state,
                }
              : printer
          ),
        }));
      }

      if (event.domain === "ops") {
        setOps((current) => mergeOps(current, event.payload));
      }
    },
  });

  const headerStats = useMemo(
    () => ({
      printing: prints.stats?.printing || 0,
      queued: prints.stats?.queued || 0,
      done: prints.stats?.done || 0,
    }),
    [prints.stats]
  );

  const stats = ops.stats || {};

  return (
    <div className={`wb-wallboard${loading ? " wb-loading" : ""}`}>
      <Header stats={headerStats} updatedAt={updatedAt} />

      <div className="wb-grid">
        <SectionOrders data={stats} />
        <SectionPrintFarm printers={prints.printers} jobs={prints.jobs} />
        <SectionQueues q={stats.queues} />
        <SectionMaterials m={stats.materials} />
        <SectionLogistics l={stats.logistics} />
        <SectionPayments p={stats.payments} />
        <SectionIndexer idx={stats.indexer} />
        <SectionIngester ing={stats.ingester} />
        <SectionWebhooks wh={stats.webhooks} />
        <SectionServices s={stats.services} />
        <SectionAlerts alerts={stats.alerts || []} />
      </div>
    </div>
  );
}