import React, { useMemo } from "react";

const PROGRESS_SUCCESS_FROM = 80;
const PROGRESS_WARNING_FROM = 35;

const PRINTER_IMAGES = {
  default: "/printer-images/default-printer.png",
  ender3v3ke: "/printer-images/ender-3v3-ke.png",
  k2: "/printer-images/k2.png",
  a1combo: "/printer-images/a1-combo.png",
};

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizePercent(value) {
  return clamp(asNumber(value, 0), 0, 100);
}

function formatInt(value) {
  return asNumber(value, 0).toLocaleString("uk-UA");
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

function formatTemperature(value) {
  return value == null ? "—" : `${formatInt(value)}°C`;
}

function getProgressClass(percent) {
  if (percent >= PROGRESS_SUCCESS_FROM) return "row-progress-fill--success";
  if (percent >= PROGRESS_WARNING_FROM) return "row-progress-fill--warning";

  return "row-progress-fill--primary";
}

function getPrinterTone(state) {
  const v = String(state || "").toLowerCase();

  if (v === "printing") return "success";
  if (v === "ready" || v === "idle") return "info";
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

function normalizeLookupKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яіїєґё.]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function getPrinterLookupKeys(printer) {
  // `model` is intentionally excluded: it is a descriptive label, not an
  // identity, and two printers can share a model (or carry a mistyped one),
  // which would let a live status attach to the wrong config card.
  return [printer?.id, printer?.name, printer?.host, printer?.ip, printer?.deviceUi]
    .map(normalizeLookupKey)
    .filter(Boolean);
}

function buildConfigMap(items) {
  const map = new Map();

  items.forEach((printer) => {
    getPrinterLookupKeys(printer).forEach((key) => {
      if (!map.has(key)) {
        map.set(key, printer);
      }
    });
  });

  return map;
}

function findConfigForPrinter(printer, configMap) {
  const keys = getPrinterLookupKeys(printer);

  for (const key of keys) {
    const config = configMap.get(key);

    if (config) return config;
  }

  return null;
}

function isDefaultImageUrl(value) {
  const imageUrl = String(value || "").trim().toLowerCase();

  return (
    !imageUrl ||
    imageUrl.endsWith("/default-printer.png") ||
    imageUrl.endsWith("default-printer.png")
  );
}

function getPresetImage(printer, config) {
  const text = [
    printer?.id,
    printer?.name,
    printer?.model,
    config?.id,
    config?.name,
    config?.model,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (text.includes("k2")) {
    return PRINTER_IMAGES.k2;
  }

  if (text.includes("a1") || text.includes("bambu")) {
    return PRINTER_IMAGES.a1combo;
  }

  if (text.includes("ender") || text.includes("v3 ke") || text.includes("v3-ke")) {
    return PRINTER_IMAGES.ender3v3ke;
  }

  return "";
}

function normalizeImageUrl(value, presetImage = "") {
  const imageUrl = String(value || "").trim();
  const lower = imageUrl.toLowerCase();

  if (isDefaultImageUrl(imageUrl)) {
    return presetImage || PRINTER_IMAGES.default;
  }

  if (lower.includes("creality-k2")) {
    return PRINTER_IMAGES.k2;
  }

  if (lower.includes("a1-combo") || lower.includes("bambu")) {
    return PRINTER_IMAGES.a1combo;
  }

  if (lower.includes("ender")) {
    return PRINTER_IMAGES.ender3v3ke;
  }

  return imageUrl;
}

function resolvePrinterImage(printer, config) {
  const presetImage = getPresetImage(printer, config);

  const liveImage = printer?.imageUrl;
  const configImage = config?.imageUrl;

  const imageUrl = isDefaultImageUrl(liveImage) ? configImage : liveImage;

  return normalizeImageUrl(imageUrl, presetImage);
}

function mergePrinterWithConfig(printer, config) {
  if (!config) {
    return {
      ...printer,
      imageUrl: resolvePrinterImage(printer, null),
    };
  }

  const merged = {
    ...config,
    ...printer,
    name: printer.name || config.name,
    model: printer.model || config.model,
    protocol: printer.protocol || config.protocol,
    host: printer.host || config.host,
    nozzle: printer.nozzle || config.nozzle,
    material: printer.material || config.material,
  };

  return {
    ...merged,
    imageUrl: resolvePrinterImage(printer, config),
  };
}

function Panel({
  title,
  subtitle,
  children,
  footer = null,
  loading = false,
}) {
  return (
    <section className={`panel${loading ? " panel-loading" : ""}`}>
      {loading ? (
        <div className="panel-loading-spinner" aria-hidden="true" />
      ) : null}

      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            <span className="panel-title-dot" />
            {title}
          </h2>

          {subtitle ? <div className="panel-subtitle">{subtitle}</div> : null}
        </div>
      </div>

      <div className="panel-body">{children}</div>

      {footer ? <div className="panel-footer">{footer}</div> : null}
    </section>
  );
}

function StatusTag({ children, tone = "primary" }) {
  const toneClass = toTagClass(tone);

  return <span className={`tag${toneClass ? ` ${toneClass}` : ""}`}>{children}</span>;
}

function EmptyState({
  title = "Немає даних",
  desc = "Зараз тут порожньо.",
}) {
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

export default function PrinterMonitoringPanel({
  printers = [],
  jobs = [],
  configs = [],
  livePrinters = [],
  monitorError = "",
  loading = false,
}) {
  const configMap = useMemo(() => {
    return buildConfigMap([...configs, ...printers]);
  }, [configs, printers]);

  const visiblePrinters = useMemo(() => {
    const source = livePrinters.length ? livePrinters : printers;

    return source.map((printer) => {
      const config = findConfigForPrinter(printer, configMap);

      return mergePrinterWithConfig(printer, config);
    });
  }, [livePrinters, printers, configMap]);

  return (
    <Panel
      loading={loading}
      title="3D-ферма — моніторинг принтерів"
      subtitle="Живий стан обладнання, температури, файли та прогрес друку"
      footer={
        <>
          <span className="panel-footer-meta">
            Принтерів: {formatInt(visiblePrinters.length)}
          </span>
          <span className="panel-footer-meta">
            Активних робіт: {formatInt(jobs.length)}
          </span>
        </>
      }
    >
      {monitorError ? (
        <div className="printer-monitor-alert">
          Помилка моніторингу: {monitorError}
        </div>
      ) : null}

      {visiblePrinters.length ? (
        <div className="printer-monitor-grid">
          {visiblePrinters.map((printer, index) => {
            const state =
              printer.status ||
              printer.state ||
              (printer.online === false ? "offline" : "unknown");

            const progress = normalizePercent(
              printer.progressPct ?? printer.progress ?? 0
            );

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
              <div
                className="printer-monitor-card"
                key={printer.id || printer.name || index}
              >
                <div className="printer-monitor-image-wrap">
                  <img
                    className="printer-monitor-image"
                    src={printer.imageUrl || PRINTER_IMAGES.default}
                    alt={printer.name || "3D-принтер"}
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.src = PRINTER_IMAGES.default;
                    }}
                  />
                </div>

                <div className="printer-monitor-top">
                  <div>
                    <div className="printer-monitor-name">
                      {printer.name || "Принтер без назви"}
                    </div>

                    <div className="printer-monitor-meta">
                      {meta || "Дані підключення не вказані"}
                    </div>
                  </div>

                  <StatusTag tone={getPrinterTone(state)}>
                    {getPrinterStateLabel(state)}
                  </StatusTag>
                </div>

                <div className="printer-monitor-file">
                  {printer.currentFile || "Файл не друкується"}
                </div>

                <div className="printer-monitor-progress">
                  <div
                    className={`printer-monitor-progress-fill ${getProgressClass(
                      progress
                    )}`}
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

                {printer.error ? (
                  <div className="printer-monitor-error">{printer.error}</div>
                ) : null}
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
                      {`${job.sku || "—"} × ${formatInt(job.qty || 0)}`}
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