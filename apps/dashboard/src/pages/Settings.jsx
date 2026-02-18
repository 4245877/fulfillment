// apps/dashboard/src/pages/Settings.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from './Settings.module.css';




const STORAGE_KEY = "fulfillment.settings.v1";

const DEFAULTS = {
  ui: {
    sseEnabled: true,
    sseTopics: ["orders", "prints", "shipments", "ops"],
    sseEventsPerSecLimit: 30,
    sseDedupWindowMs: 1500,
    pollingEnabled: false,
    pollingIntervalMs: 10000,

    boardSections: {
      orders: true,
      printFarm: true,
      queues: true,
      materials: true,
      logistics: true,
      payments: true,
      services: true,
      indexer: true,
      ingester: true,
      webhooks: true,
      alerts: true,
    },

    thresholds: {
      queueLagWarnMs: 5000,
      queueLagDangerMs: 60000,
      indexerBacklogWarn: 10000,
      indexerBacklogDanger: 100000,
      ingesterBacklogWarn: 10000,
      ingesterBacklogDanger: 100000,
      lowFilamentWarnKg: 1.0,
      lowResinWarnL: 0.5,
    },

    locale: {
      timezone: "Europe/Kyiv",
      timeFormat: "24h", // 24h | 12h
      currency: "UAH",
    },
  },

  backups: {
    schedulePreset: "daily", // hourly | daily | weekly | custom
    cron: "0 3 * * *",
    mode: "full", // full | incremental
    include: {
      db: true,
      media: true,
      config: true,
      search: false,
    },
    window: {
      start: "02:00",
      end: "06:00",
      avoidPeak: true,
    },
    retention: {
      daily: 14,
      weekly: 8,
      monthly: 6,
    },
    storage: {
      provider: "minio", // s3 | minio | filesystem
      bucket: "backups",
      path: "fulfillment/",
      encryptionProfile: "server-managed", // server-managed | none | custom
      keyProfile: "default",
    },
  },

  infra: {
    nodes: [
      { name: "api-1", role: "api", host: "localhost", notes: "" },
      { name: "worker-1", role: "worker", host: "localhost", notes: "" },
    ],
    pools: {
      maxWorkersPrints: 6,
      maxWorkersImports: 4,
      maxWorkersMedia: 4,
      maxWorkersWebhooks: 4,
      externalApiRateLimitRps: 5,
    },
    maintenance: {
      enabled: false,
      allowCatalogRead: true,
      blockCheckout: true,
      message: "Технічні роботи. Спробуй, будь ласка, трохи пізніше.",
    },
  },

  ops: {
    degradation: {
      errorRateWarnPct: 2,
      errorRateDangerPct: 5,
      p95LatencyWarnMs: 800,
      p95LatencyDangerMs: 2000,
      timeoutWarnPct: 1,
      timeoutDangerPct: 3,
    },
    actions: {
      allowed: {
        restartService: true,
        rotateSecrets: false,
        reloadConfig: true,
        pauseQueue: true,
        drainQueue: false,
        rebuildSearchIndex: false,
      },
    },
  },

  queues: {
    thresholds: {
      readyWarn: 200,
      readyDanger: 1000,
      runningWarn: 20,
      runningDanger: 80,
    },
    retries: {
      maxRetries: 6,
      backoffMs: 1500,
      backoffMaxMs: 30000,
      dlqEnabled: true,
    },
    policies: {
      webhookDedupEnabled: true,
      webhookDedupWindowMs: 60000,
      maxBatchSize: 500,
      jobTimeoutMs: 300000,
      visibilityTimeoutMs: 600000,
    },
  },

  catalog: {
    ingester: {
      batchSizeRows: 2000,
      concurrency: 4,
      normalize: {
        validateSku: true,
        dedupSku: true,
        fallbackOnMissingFields: true,
      },
      media: {
        maxFileMb: 25,
        allowedFormats: ["jpg", "png", "webp", "mp4"],
        queue: "media",
        retries: 4,
      },
    },
    indexer: {
      shards: 3,
      replicas: 1,
      ratePerMin: 3000,
      reindexMode: "partial", // partial | full
      indexedFields: ["sku", "title", "tags", "category", "attributes"],
      stopWordsProfile: "default",
    },
    retention: {
      importLogsDays: 30,
      importErrorsDays: 90,
      auditDays: 180,
    },
  },

  printFarm: {
    printers: [
      { id: "a1", name: "Bambu A1", profile: "fdm-0.4", material: "PLA", enabled: true },
      { id: "ke", name: "Ender 3 V3 KE", profile: "fdm-0.4", material: "PETG", enabled: true },
    ],
    routing: {
      rules: [
        { when: "material=PLA", then: "printerGroup=fdm-pla" },
        { when: "material=RESIN", then: "printerGroup=resin" },
      ],
    },
    sla: {
      autoPauseOnError: true,
      idleNotifyMinutes: 45,
      errorNotifyMinutes: 2,
    },
  },

  logisticsPayments: {
    providers: {
      novaPoshta: { enabled: true, rateLimitRps: 2, profile: "default" },
      ukrposhta: { enabled: false, rateLimitRps: 1, profile: "default" },
      payments: { enabled: true, rateLimitRps: 2, profile: "default" },
    },
    statusMapping: {
      shipment: {
        created: "new",
        accepted: "inTransit",
        delivered: "delivered",
        problem: "problem",
      },
    },
    antifraud: {
      enabled: false,
      maxOrderValueUAH: 20000,
      requireManualReviewAboveUAH: 15000,
    },
  },

  webhooks: {
    policy: {
      retries: 6,
      backoffMs: 2000,
      idempotencyEnabled: true,
      signatureVerification: true,
    },
    recentErrors: [], // UI-only placeholder
  },

  alerts: {
    channels: {
      telegram: { enabled: true, profile: "ops-main" },
      slack: { enabled: false, profile: "default" },
      email: { enabled: false, profile: "default" },
      webhook: { enabled: false, profile: "default" },
    },
    rules: {
      queueLagMs: 60000,
      queueLagForMinutes: 5,
      errorRatePct: 5,
      indexerBacklog: 100000,
      backupFailed: true,
    },
    quietHours: {
      enabled: true,
      start: "23:00",
      end: "07:00",
      timezone: "Europe/Kyiv",
    },
  },

  security: {
    rbac: {
      allowRestart: ["admin", "ops"],
      allowBackups: ["admin", "ops"],
      allowReindex: ["admin"],
      allowSecretsRotate: ["admin"],
    },
    audit: {
      enabled: true,
      // UI-only placeholder
      recent: [{ ts: "—", actor: "—", action: "—", target: "—" }],
    },
  },
};

// ---------- невеликі утиліти ----------
function safeParseJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function mergeDefaults(defaults, incoming) {
  // просте рекурсивне «накладання» вхідних значень поверх дефолтів
  if (Array.isArray(defaults)) return Array.isArray(incoming) ? incoming : defaults;
  if (defaults && typeof defaults === "object") {
    const out = { ...defaults };
    if (incoming && typeof incoming === "object") {
      for (const k of Object.keys(incoming)) out[k] = mergeDefaults(defaults[k], incoming[k]);
    }
    return out;
  }
  return incoming === undefined ? defaults : incoming;
}

function cloneDeep(obj) {
  // Перевага structuredClone (зберігає Date/Infinity тощо), fallback — JSON-клон.
  if (typeof structuredClone === "function") return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

// Клонувати лише вздовж шляху (дешево для великих конфігів)
function setByPath(obj, path, value) {
  const parts = String(path).split(".").filter(Boolean);
  if (!parts.length) return obj;

  const nextRoot = Array.isArray(obj) ? obj.slice() : { ...obj };
  let curNext = nextRoot;
  let curPrev = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const prevChild = curPrev && typeof curPrev === "object" ? curPrev[k] : undefined;

    let nextChild;
    if (Array.isArray(prevChild)) nextChild = prevChild.slice();
    else if (prevChild && typeof prevChild === "object") nextChild = { ...prevChild };
    else nextChild = {};

    curNext[k] = nextChild;
    curNext = nextChild;
    curPrev = prevChild;
  }

  curNext[parts[parts.length - 1]] = value;
  return nextRoot;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const snippet = text ? `\n\n${text.slice(0, 300)}` : "";
    throw new Error(`${res.status} ${res.statusText} @ ${url}${snippet}`);
  }
  return json;
}

// ---------- UI-атоми ----------
function Card({ title, sub, children, right }) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{title}</div>
          {sub ? (
            <div className="muted" style={{ fontSize: 12 }}>
              {sub}
            </div>
          ) : null}
        </div>
        {right ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{right}</div> : null}
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  );
}

function FieldRow({ label, hint, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12, padding: "10px 0" }}>
      <div>
        <div style={{ fontWeight: 650 }}>{label}</div>
        {hint ? (
          <div className="muted" style={{ fontSize: 12 }}>
            {hint}
          </div>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Toggle({ value, onChange, label }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18 }}
      />
      <span>{label}</span>
    </label>
  );
}

function NumberInput({ value, onChange, min, max, step }) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
    />
  );
}

function TextInput({ value, onChange, placeholder }) {
  return <input value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function TextArea({ value, onChange, placeholder, rows = 3, onBlur, onKeyDown }) {
  return (
    <textarea
      rows={rows}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  );
}

function ChipsEditor({ value, onChange, placeholder = "Введи та натисни Enter" }) {
  const [draft, setDraft] = useState("");
  const items = Array.isArray(value) ? value : [];

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {items.map((x, i) => (
          <span key={`${x}-${i}`} className="tag" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {x}
            <button
              type="button"
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              style={{ padding: "2px 8px" }}
              aria-label="remove"
            >
              ×
            </button>
          </span>
        ))}
        {!items.length ? <span className="muted">—</span> : null}
      </div>

      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const v = draft.trim();
            if (!v) return;
            if (!items.includes(v)) onChange([...items, v]);
            setDraft("");
          }
        }}
      />
    </div>
  );
}

function DangerZone({ title, children }) {
  return (
    <div
      style={{
        border: "1px solid var(--danger-border)",
        borderRadius: 12,
        padding: 12,
        background: "color-mix(in srgb, var(--secondary) 6%, var(--surface))",
      }}
    >
      <div style={{ fontWeight: 800, color: "var(--danger-text)", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

// ---------- сторінка ----------
export default function Settings() {
  const [cfg, setCfg] = useState(() => {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    const parsed = raw ? safeParseJSON(raw) : null;
    return mergeDefaults(DEFAULTS, parsed || {});
  });

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const saveTimerRef = useRef(null);

  const showToast = (nextToast, ms = 1500) => {
    setToast(nextToast);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
    if (ms != null) {
      toastTimerRef.current = setTimeout(() => {
        setToast(null);
        toastTimerRef.current = null;
      }, ms);
    }
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const nav = useMemo(
    () => [
      { id: "ui", title: "1) Загальне (UI/Wallboard)" },
      { id: "backups", title: "2) Резервні копії та зберігання" },
      { id: "infra", title: "3) Інфраструктура (Servers/Topology)" },
      { id: "ops", title: "4) Стан сервісів і дії оператора" },
      { id: "queues", title: "5) Черги та воркери (Queues)" },
      { id: "catalog", title: "6) Каталог 3M SKU: Indexer / Ingester / Import" },
      { id: "printFarm", title: "7) Виробництво / Print Farm" },
      { id: "logisticsPayments", title: "8) Логістика та оплати" },
      { id: "webhooks", title: "9) Вебхуки" },
      { id: "alerts", title: "10) Алерти та сповіщення" },
      { id: "security", title: "11) Безпека та доступ" },
    ],
    []
  );

  // автозбереження (локально) — безшумно; toast лише при помилці
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
      } catch {
        showToast({ kind: "error", text: "Не вдалося зберегти (localStorage)." }, 3000);
      }
    }, 350);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [cfg]);

  const patch = (path, value) => setCfg((cur) => setByPath(cur, path, value));

  // ----- редактор statusMapping (чернетка) -----
  const [statusMappingDraft, setStatusMappingDraft] = useState(() =>
    JSON.stringify(cfg.logisticsPayments.statusMapping, null, 2)
  );
  const [statusMappingError, setStatusMappingError] = useState(null);

  useEffect(() => {
    setStatusMappingDraft(JSON.stringify(cfg.logisticsPayments.statusMapping, null, 2));
    setStatusMappingError(null);
  }, [cfg.logisticsPayments.statusMapping]);

  const validateStatusMappingDraft = (text) => {
    const parsed = safeParseJSON(text);
    if (!parsed) {
      setStatusMappingError("Помилка JSON: перевір, будь ласка, дужки/коми/лапки.");
      return null;
    }
    setStatusMappingError(null);
    return parsed;
  };

  const applyStatusMappingDraft = () => {
    const parsed = validateStatusMappingDraft(statusMappingDraft);
    if (!parsed) return;
    patch("logisticsPayments.statusMapping", parsed);
    showToast({ kind: "success", text: "Маппінг застосовано ✅" }, 1200);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fulfillment-settings.json";
    a.click();
    // revoke трохи пізніше: у деяких браузерах ранній revoke ламає завантаження
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const importJson = async (file) => {
    const text = await file.text();
    const parsed = safeParseJSON(text);
    if (!parsed) {
      showToast({ kind: "error", text: "Файл не схожий на JSON." }, 2500);
      return;
    }
    setCfg(mergeDefaults(DEFAULTS, parsed));
    showToast({ kind: "success", text: "Імпортовано ✅" }, 1500);
  };

  const resetAll = () => {
    if (!window.confirm("Скинути всі налаштування до значень за замовчуванням?")) return;
    setCfg(cloneDeep(DEFAULTS));
    showToast({ kind: "success", text: "Скинуто ✅" }, 1200);
  };

  const doAction = async ({ title, description, url, body }) => {
    const ok = window.confirm(`${title}\n\n${description || ""}\n\nПідтвердити?`);
    if (!ok) return;

    try {
      await postJson(url, body);
      showToast({ kind: "success", text: `${title}: OK` }, 2500);
    } catch (e) {
      showToast({ kind: "error", text: `${title}: ${String(e.message || e)}` }, 3500);
    }
  };

  const cronFromPreset = (preset) => {
    if (preset === "hourly") return "0 * * * *";
    if (preset === "daily") return "0 3 * * *";
    if (preset === "weekly") return "0 4 * * 0";
    return cfg.backups.cron;
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>
      {/* Ліва навігація */}
      <div className="card" style={{ position: "sticky", top: 16 }}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Налаштування</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Зміни зберігаються локально в браузері. Пізніше можна підключити збереження на сервері.
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button className="buttonSecondary" type="button" onClick={exportJson}>
            Експорт JSON
          </button>
          <label className="buttonSecondary" style={{ cursor: "pointer" }}>
            Імпорт JSON
            <input
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJson(f);
                e.target.value = "";
              }}
            />
          </label>
          <button type="button" onClick={resetAll}>
            Скинути
          </button>
        </div>

        <div style={{ borderTop: "1px solid var(--border)", margin: "12px 0" }} />

        <div style={{ display: "grid", gap: 6 }}>
          {nav.map((x) => (
            <a
              key={x.id}
              href={`#${x.id}`}
              style={{
                padding: "6px 8px",
                borderRadius: 10,
                background: "color-mix(in srgb, var(--primary) 3%, transparent)",
              }}
            >
              {x.title}
            </a>
          ))}
        </div>

        {toast ? (
          <div style={{ marginTop: 12 }}>
            <div className={toast.kind === "error" ? "errorBox" : "successBox"}>{toast.text}</div>
          </div>
        ) : null}
      </div>

      {/* Контент */}
      <div>
        {/* 1) UI */}
        <div id="ui" />
        <Card
          title="1) Загальне (UI/Wallboard)"
          sub="SSE/polling, перемикачі секцій, пороги підсвічування, локаль/час/валюта"
        >
          <FieldRow label="SSE (Server-Sent Events)" hint="Якщо увімкнено — Board може отримувати оновлення без polling.">
            <div style={{ display: "grid", gap: 10 }}>
              <Toggle value={cfg.ui.sseEnabled} onChange={(v) => patch("ui.sseEnabled", v)} label="Увімкнути SSE" />
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                  Теми (orders, prints, shipments, ops)
                </div>
                <ChipsEditor
                  value={cfg.ui.sseTopics}
                  onChange={(arr) => patch("ui.sseTopics", arr)}
                  placeholder="Напр.: orders"
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Ліміт подій/сек
                  </div>
                  <NumberInput
                    value={cfg.ui.sseEventsPerSecLimit}
                    min={1}
                    max={500}
                    onChange={(v) => patch("ui.sseEventsPerSecLimit", v)}
                  />
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Дедуплікація (мс)
                  </div>
                  <NumberInput
                    value={cfg.ui.sseDedupWindowMs}
                    min={0}
                    max={600000}
                    step={100}
                    onChange={(v) => patch("ui.sseDedupWindowMs", v)}
                  />
                </div>
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Опитування (polling)" hint="Запасний режим, якщо SSE недоступний.">
            <div style={{ display: "grid", gap: 10 }}>
              <Toggle
                value={cfg.ui.pollingEnabled}
                onChange={(v) => patch("ui.pollingEnabled", v)}
                label="Увімкнути polling"
              />
              <div style={{ maxWidth: 320 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  Інтервал (мс)
                </div>
                <NumberInput
                  value={cfg.ui.pollingIntervalMs}
                  min={1000}
                  max={600000}
                  step={500}
                  onChange={(v) => patch("ui.pollingIntervalMs", v)}
                />
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Board: показувати секції" hint="Feature toggles для головної дошки (Board).">
            <div style={{ display: "grid", gap: 6 }}>
              {Object.entries(cfg.ui.boardSections).map(([k, v]) => (
                <Toggle key={k} value={v} onChange={(next) => patch(`ui.boardSections.${k}`, next)} label={k} />
              ))}
            </div>
          </FieldRow>

          <FieldRow label="Пороги підсвічування (warn/danger)" hint="Використовуються для KPI, lag, backlog, низьких запасів.">
            <div style={{ display: "grid", gap: 12 }}>
              <div className="card" style={{ padding: 12 }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Затримка (lag) черг (мс)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      warn
                    </div>
                    <NumberInput
                      value={cfg.ui.thresholds.queueLagWarnMs}
                      min={0}
                      max={3600000}
                      step={500}
                      onChange={(v) => patch("ui.thresholds.queueLagWarnMs", v)}
                    />
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      danger
                    </div>
                    <NumberInput
                      value={cfg.ui.thresholds.queueLagDangerMs}
                      min={0}
                      max={3600000}
                      step={500}
                      onChange={(v) => patch("ui.thresholds.queueLagDangerMs", v)}
                    />
                  </div>
                </div>
              </div>

              <div className="card" style={{ padding: 12 }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Backlog (Indexer/Ingester)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Indexer warn
                    </div>
                    <NumberInput
                      value={cfg.ui.thresholds.indexerBacklogWarn}
                      min={0}
                      max={100000000}
                      step={1000}
                      onChange={(v) => patch("ui.thresholds.indexerBacklogWarn", v)}
                    />
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Indexer danger
                    </div>
                    <NumberInput
                      value={cfg.ui.thresholds.indexerBacklogDanger}
                      min={0}
                      max={100000000}
                      step={1000}
                      onChange={(v) => patch("ui.thresholds.indexerBacklogDanger", v)}
                    />
                  </div>

                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Ingester warn
                    </div>
                    <NumberInput
                      value={cfg.ui.thresholds.ingesterBacklogWarn}
                      min={0}
                      max={100000000}
                      step={1000}
                      onChange={(v) => patch("ui.thresholds.ingesterBacklogWarn", v)}
                    />
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Ingester danger
                    </div>
                    <NumberInput
                      value={cfg.ui.thresholds.ingesterBacklogDanger}
                      min={0}
                      max={100000000}
                      step={1000}
                      onChange={(v) => patch("ui.thresholds.ingesterBacklogDanger", v)}
                    />
                  </div>
                </div>
              </div>

              <div className="card" style={{ padding: 12 }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Низький запас матеріалів</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Філамент: warn (кг)
                    </div>
                    <NumberInput
                      value={cfg.ui.thresholds.lowFilamentWarnKg}
                      min={0}
                      max={1000}
                      step={0.1}
                      onChange={(v) => patch("ui.thresholds.lowFilamentWarnKg", v)}
                    />
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Смола: warn (л)
                    </div>
                    <NumberInput
                      value={cfg.ui.thresholds.lowResinWarnL}
                      min={0}
                      max={1000}
                      step={0.1}
                      onChange={(v) => patch("ui.thresholds.lowResinWarnL", v)}
                    />
                  </div>
                </div>
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Локаль: часовий пояс/час/валюта" hint="Форматування часу на Board та грошових значень у таблицях.">
            <div style={{ display: "grid", gap: 12, maxWidth: 520 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Часовий пояс
                </div>
                <TextInput value={cfg.ui.locale.timezone} onChange={(v) => patch("ui.locale.timezone", v)} placeholder="Europe/Kyiv" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Формат часу
                  </div>
                  <Select
                    value={cfg.ui.locale.timeFormat}
                    onChange={(v) => patch("ui.locale.timeFormat", v)}
                    options={[
                      { value: "24h", label: "24h" },
                      { value: "12h", label: "12h" },
                    ]}
                  />
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Валюта
                  </div>
                  <Select
                    value={cfg.ui.locale.currency}
                    onChange={(v) => patch("ui.locale.currency", v)}
                    options={[
                      { value: "UAH", label: "UAH (₴)" },
                      { value: "USD", label: "USD ($)" },
                      { value: "EUR", label: "EUR (€)" },
                    ]}
                  />
                </div>
              </div>
            </div>
          </FieldRow>
        </Card>

        {/* 2) Backups */}
        <div id="backups" />
        <Card title="2) Резервні копії та зберігання" sub="Розклад, склад резервної копії, ретеншн, сховище, ручні дії">
          <FieldRow label="Розклад" hint="Preset або власний cron.">
            <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
              <Select
                value={cfg.backups.schedulePreset}
                onChange={(v) => {
                  patch("backups.schedulePreset", v);
                  if (v !== "custom") patch("backups.cron", cronFromPreset(v));
                }}
                options={[
                  { value: "hourly", label: "hourly" },
                  { value: "daily", label: "daily" },
                  { value: "weekly", label: "weekly" },
                  { value: "custom", label: "custom (cron)" },
                ]}
              />
              <TextInput value={cfg.backups.cron} onChange={(v) => patch("backups.cron", v)} placeholder="0 3 * * *" />
            </div>
          </FieldRow>

          <FieldRow label="Тип і склад резервної копії" hint="Full/incremental + що саме резервуємо.">
            <div style={{ display: "grid", gap: 10 }}>
              <Select
                value={cfg.backups.mode}
                onChange={(v) => patch("backups.mode", v)}
                options={[
                  { value: "full", label: "full" },
                  { value: "incremental", label: "incremental" },
                ]}
              />
              <div style={{ display: "grid", gap: 6 }}>
                {Object.entries(cfg.backups.include).map(([k, v]) => (
                  <Toggle key={k} value={v} onChange={(nv) => patch(`backups.include.${k}`, nv)} label={k} />
                ))}
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Вікно виконання" hint="Щоб не заважати піковим годинам.">
            <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
              <Toggle value={cfg.backups.window.avoidPeak} onChange={(v) => patch("backups.window.avoidPeak", v)} label="Уникати піку" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    початок
                  </div>
                  <TextInput value={cfg.backups.window.start} onChange={(v) => patch("backups.window.start", v)} placeholder="02:00" />
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    кінець
                  </div>
                  <TextInput value={cfg.backups.window.end} onChange={(v) => patch("backups.window.end", v)} placeholder="06:00" />
                </div>
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Ретеншн" hint="Скільки зберігати daily/weekly/monthly.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, maxWidth: 520 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  daily
                </div>
                <NumberInput value={cfg.backups.retention.daily} min={0} max={3650} onChange={(v) => patch("backups.retention.daily", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  weekly
                </div>
                <NumberInput value={cfg.backups.retention.weekly} min={0} max={520} onChange={(v) => patch("backups.retention.weekly", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  monthly
                </div>
                <NumberInput value={cfg.backups.retention.monthly} min={0} max={240} onChange={(v) => patch("backups.retention.monthly", v)} />
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Сховище резервних копій" hint="S3/MinIO/Filesystem. Ключі зазвичай зберігаються на сервері — тут лише профіль.">
            <div style={{ display: "grid", gap: 12, maxWidth: 620 }}>
              <Select
                value={cfg.backups.storage.provider}
                onChange={(v) => patch("backups.storage.provider", v)}
                options={[
                  { value: "minio", label: "minio" },
                  { value: "s3", label: "s3" },
                  { value: "filesystem", label: "filesystem" },
                ]}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Бакет (bucket)
                  </div>
                  <TextInput value={cfg.backups.storage.bucket} onChange={(v) => patch("backups.storage.bucket", v)} placeholder="backups" />
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Шлях (path)
                  </div>
                  <TextInput value={cfg.backups.storage.path} onChange={(v) => patch("backups.storage.path", v)} placeholder="fulfillment/" />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Профіль шифрування
                  </div>
                  <TextInput
                    value={cfg.backups.storage.encryptionProfile}
                    onChange={(v) => patch("backups.storage.encryptionProfile", v)}
                    placeholder="server-managed"
                  />
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Профіль ключа
                  </div>
                  <TextInput value={cfg.backups.storage.keyProfile} onChange={(v) => patch("backups.storage.keyProfile", v)} placeholder="default" />
                </div>
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Ручні дії" hint="Поки що кнопки викликають API-ендпоїнти, якщо вони реалізовані.">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="buttonPrimary"
                type="button"
                onClick={() =>
                  doAction({
                    title: "Запустити бекап зараз",
                    description: "Запустити резервне копіювання негайно.",
                    url: "/api/ops/backup/run",
                    body: { scope: cfg.backups.include, mode: cfg.backups.mode },
                  })
                }
              >
                Запустити бекап
              </button>

              <button
                type="button"
                onClick={() =>
                  doAction({
                    title: "Тестове відновлення",
                    description: "Тестове відновлення у пісочниці (якщо є).",
                    url: "/api/ops/backup/test-restore",
                    body: { profile: cfg.backups.storage.keyProfile },
                  })
                }
              >
                Тестове відновлення
              </button>
            </div>
          </FieldRow>
        </Card>

        {/* 3) Infra */}
        <div id="infra" />
        <Card title="3) Інфраструктура (Servers/Topology)" sub="Ноди, ролі, пули/ліміти, режим технічних робіт">
          <FieldRow label="Список нод" hint="Назва, роль, хост. (UI-список; серверні дані підтягуються пізніше).">
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Назва</th>
                      <th>Роль</th>
                      <th>Хост</th>
                      <th>Нотатки</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(cfg.infra.nodes || []).map((n, i) => (
                      <tr key={`${n.name}-${i}`}>
                        <td>
                          <input
                            value={n.name}
                            onChange={(e) => {
                              const next = [...cfg.infra.nodes];
                              next[i] = { ...next[i], name: e.target.value };
                              patch("infra.nodes", next);
                            }}
                          />
                        </td>
                        <td>
                          <select
                            value={n.role}
                            onChange={(e) => {
                              const next = [...cfg.infra.nodes];
                              next[i] = { ...next[i], role: e.target.value };
                              patch("infra.nodes", next);
                            }}
                          >
                            {["api", "worker", "db", "search", "printers", "media"].map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            value={n.host}
                            onChange={(e) => {
                              const next = [...cfg.infra.nodes];
                              next[i] = { ...next[i], host: e.target.value };
                              patch("infra.nodes", next);
                            }}
                          />
                        </td>
                        <td>
                          <input
                            value={n.notes || ""}
                            onChange={(e) => {
                              const next = [...cfg.infra.nodes];
                              next[i] = { ...next[i], notes: e.target.value };
                              patch("infra.nodes", next);
                            }}
                          />
                        </td>
                        <td style={{ width: 1, whiteSpace: "nowrap" }}>
                          <button
                            type="button"
                            onClick={() => {
                              const next = cfg.infra.nodes.filter((_, idx) => idx !== i);
                              patch("infra.nodes", next);
                            }}
                          >
                            Видалити
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={() => patch("infra.nodes", [...(cfg.infra.nodes || []), { name: "new-node", role: "worker", host: "", notes: "" }])}
              >
                Додати ноду
              </button>
            </div>
          </FieldRow>

          <FieldRow label="Пули та ліміти" hint="Обмеження на воркери/черги та rate-limit зовнішніх API.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  maxWorkersPrints
                </div>
                <NumberInput value={cfg.infra.pools.maxWorkersPrints} min={0} max={999} onChange={(v) => patch("infra.pools.maxWorkersPrints", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  maxWorkersImports
                </div>
                <NumberInput value={cfg.infra.pools.maxWorkersImports} min={0} max={999} onChange={(v) => patch("infra.pools.maxWorkersImports", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  maxWorkersMedia
                </div>
                <NumberInput value={cfg.infra.pools.maxWorkersMedia} min={0} max={999} onChange={(v) => patch("infra.pools.maxWorkersMedia", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  maxWorkersWebhooks
                </div>
                <NumberInput value={cfg.infra.pools.maxWorkersWebhooks} min={0} max={999} onChange={(v) => patch("infra.pools.maxWorkersWebhooks", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  externalApiRateLimitRps
                </div>
                <NumberInput
                  value={cfg.infra.pools.externalApiRateLimitRps}
                  min={0}
                  max={1000}
                  step={1}
                  onChange={(v) => patch("infra.pools.externalApiRateLimitRps", v)}
                />
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Режим технічних робіт (maintenance)" hint="Обмежує функції, але може дозволити читання каталогу.">
            <div style={{ display: "grid", gap: 10 }}>
              <Toggle value={cfg.infra.maintenance.enabled} onChange={(v) => patch("infra.maintenance.enabled", v)} label="Увімкнути режим техробіт" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 520 }}>
                <Toggle
                  value={cfg.infra.maintenance.allowCatalogRead}
                  onChange={(v) => patch("infra.maintenance.allowCatalogRead", v)}
                  label="Дозволити читання каталогу"
                />
                <Toggle value={cfg.infra.maintenance.blockCheckout} onChange={(v) => patch("infra.maintenance.blockCheckout", v)} label="Заборонити checkout" />
              </div>
              <TextArea value={cfg.infra.maintenance.message} onChange={(v) => patch("infra.maintenance.message", v)} rows={3} placeholder="Повідомлення для користувачів" />
            </div>
          </FieldRow>
        </Card>

        {/* 4) Ops */}
        <div id="ops" />
        <Card title="4) Стан сервісів і дії оператора" sub="Пороги деградації + кнопки оператора (з підтвердженням)">
          <FieldRow label="Пороги деградації" hint="% помилок, p95 latency, timeouts.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  errorRateWarnPct
                </div>
                <NumberInput value={cfg.ops.degradation.errorRateWarnPct} min={0} max={100} step={0.1} onChange={(v) => patch("ops.degradation.errorRateWarnPct", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  errorRateDangerPct
                </div>
                <NumberInput value={cfg.ops.degradation.errorRateDangerPct} min={0} max={100} step={0.1} onChange={(v) => patch("ops.degradation.errorRateDangerPct", v)} />
              </div>

              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  p95LatencyWarnMs
                </div>
                <NumberInput value={cfg.ops.degradation.p95LatencyWarnMs} min={0} max={600000} step={50} onChange={(v) => patch("ops.degradation.p95LatencyWarnMs", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  p95LatencyDangerMs
                </div>
                <NumberInput value={cfg.ops.degradation.p95LatencyDangerMs} min={0} max={600000} step={50} onChange={(v) => patch("ops.degradation.p95LatencyDangerMs", v)} />
              </div>

              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  timeoutWarnPct
                </div>
                <NumberInput value={cfg.ops.degradation.timeoutWarnPct} min={0} max={100} step={0.1} onChange={(v) => patch("ops.degradation.timeoutWarnPct", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  timeoutDangerPct
                </div>
                <NumberInput value={cfg.ops.degradation.timeoutDangerPct} min={0} max={100} step={0.1} onChange={(v) => patch("ops.degradation.timeoutDangerPct", v)} />
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Операційні дії" hint="Кнопки безпечні: завжди з підтвердженням. Працюють, якщо API реалізовано.">
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  disabled={!cfg.ops.actions.allowed.restartService}
                  onClick={() =>
                    doAction({
                      title: "Перезапустити сервіс",
                      description: "Перезапуск сервісу (за назвою).",
                      url: "/api/ops/service/restart",
                      body: { service: "api" },
                    })
                  }
                >
                  перезапустити api
                </button>

                <button
                  type="button"
                  disabled={!cfg.ops.actions.allowed.reloadConfig}
                  onClick={() =>
                    doAction({
                      title: "Перечитати конфіг",
                      description: "Перечитати конфіг без перезапуску.",
                      url: "/api/ops/config/reload",
                      body: {},
                    })
                  }
                >
                  перечитати конфіг
                </button>

                <button
                  type="button"
                  disabled={!cfg.ops.actions.allowed.pauseQueue}
                  onClick={() =>
                    doAction({
                      title: "Пауза черги",
                      description: "Пауза обробки черги.",
                      url: "/api/ops/queue/pause",
                      body: { queue: "prints" },
                    })
                  }
                >
                  пауза prints
                </button>

                <button
                  type="button"
                  disabled={!cfg.ops.actions.allowed.drainQueue}
                  onClick={() =>
                    doAction({
                      title: "Очистити чергу",
                      description: "Очистити чергу (обережно).",
                      url: "/api/ops/queue/drain",
                      body: { queue: "webhooks" },
                    })
                  }
                >
                  очистити webhooks
                </button>
              </div>

              <DangerZone title="Небезпечна зона">
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  Rebuild search index може зупинити пошук та навантажити інфраструктуру. Увімкай тільки якщо точно треба.
                </div>
                <button
                  type="button"
                  disabled={!cfg.ops.actions.allowed.rebuildSearchIndex}
                  onClick={() =>
                    doAction({
                      title: "Перебудувати пошуковий індекс",
                      description: "Повна перебудова індексу (НЕБЕЗПЕЧНО).",
                      url: "/api/ops/search/rebuild",
                      body: { mode: "full" },
                    })
                  }
                >
                  перебудувати індекс
                </button>
              </DangerZone>
            </div>
          </FieldRow>
        </Card>

        {/* 5) Queues */}
        <div id="queues" />
        <Card title="5) Черги та воркери (Queues)" sub="Конкурентність, повторні спроби, DLQ, дедуп, батчі, таймаути">
          <FieldRow label="Пороги" hint="ready/running thresholds для підсвічування та алертів.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  readyWarn
                </div>
                <NumberInput value={cfg.queues.thresholds.readyWarn} min={0} max={1000000} onChange={(v) => patch("queues.thresholds.readyWarn", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  readyDanger
                </div>
                <NumberInput value={cfg.queues.thresholds.readyDanger} min={0} max={1000000} onChange={(v) => patch("queues.thresholds.readyDanger", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  runningWarn
                </div>
                <NumberInput value={cfg.queues.thresholds.runningWarn} min={0} max={1000000} onChange={(v) => patch("queues.thresholds.runningWarn", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  runningDanger
                </div>
                <NumberInput value={cfg.queues.thresholds.runningDanger} min={0} max={1000000} onChange={(v) => patch("queues.thresholds.runningDanger", v)} />
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Повторні спроби / Backoff / DLQ" hint="Політика повторних спроб і dead-letter queue.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  maxRetries
                </div>
                <NumberInput value={cfg.queues.retries.maxRetries} min={0} max={100} onChange={(v) => patch("queues.retries.maxRetries", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  backoffMs
                </div>
                <NumberInput value={cfg.queues.retries.backoffMs} min={0} max={600000} step={100} onChange={(v) => patch("queues.retries.backoffMs", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  backoffMaxMs
                </div>
                <NumberInput value={cfg.queues.retries.backoffMaxMs} min={0} max={3600000} step={100} onChange={(v) => patch("queues.retries.backoffMaxMs", v)} />
              </div>
              <div style={{ display: "flex", alignItems: "center" }}>
                <Toggle value={cfg.queues.retries.dlqEnabled} onChange={(v) => patch("queues.retries.dlqEnabled", v)} label="DLQ увімкнено" />
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Політики обробки" hint="Дедуп вебхуків, батчі, таймаути.">
            <div style={{ display: "grid", gap: 12, maxWidth: 720 }}>
              <Toggle value={cfg.queues.policies.webhookDedupEnabled} onChange={(v) => patch("queues.policies.webhookDedupEnabled", v)} label="Дедуплікація вебхуків" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    webhookDedupWindowMs
                  </div>
                  <NumberInput value={cfg.queues.policies.webhookDedupWindowMs} min={0} max={3600000} step={1000} onChange={(v) => patch("queues.policies.webhookDedupWindowMs", v)} />
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    maxBatchSize
                  </div>
                  <NumberInput value={cfg.queues.policies.maxBatchSize} min={1} max={100000} step={10} onChange={(v) => patch("queues.policies.maxBatchSize", v)} />
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    jobTimeoutMs
                  </div>
                  <NumberInput value={cfg.queues.policies.jobTimeoutMs} min={0} max={36000000} step={1000} onChange={(v) => patch("queues.policies.jobTimeoutMs", v)} />
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    visibilityTimeoutMs
                  </div>
                  <NumberInput value={cfg.queues.policies.visibilityTimeoutMs} min={0} max={36000000} step={1000} onChange={(v) => patch("queues.policies.visibilityTimeoutMs", v)} />
                </div>
              </div>
            </div>
          </FieldRow>
        </Card>

        {/* 6) Catalog */}
        <div id="catalog" />
        <Card title="6) Каталог 3M SKU: Indexer / Ingester / Import" sub="Пакети, паралельність, нормалізація, медіа, індекс, ретеншн логів">
          <FieldRow label="Ingester" hint="Batch size, паралельність, правила нормалізації, медіа-пайплайн.">
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    batchSizeRows
                  </div>
                  <NumberInput value={cfg.catalog.ingester.batchSizeRows} min={1} max={1000000} step={100} onChange={(v) => patch("catalog.ingester.batchSizeRows", v)} />
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    concurrency
                  </div>
                  <NumberInput value={cfg.catalog.ingester.concurrency} min={1} max={256} onChange={(v) => patch("catalog.ingester.concurrency", v)} />
                </div>
              </div>

              <div className="card" style={{ padding: 12 }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Нормалізація</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {Object.entries(cfg.catalog.ingester.normalize).map(([k, v]) => (
                    <Toggle key={k} value={v} onChange={(nv) => patch(`catalog.ingester.normalize.${k}`, nv)} label={k} />
                  ))}
                </div>
              </div>

              <div className="card" style={{ padding: 12 }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Медіа</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      maxFileMb
                    </div>
                    <NumberInput value={cfg.catalog.ingester.media.maxFileMb} min={1} max={2000} onChange={(v) => patch("catalog.ingester.media.maxFileMb", v)} />
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      retries
                    </div>
                    <NumberInput value={cfg.catalog.ingester.media.retries} min={0} max={100} onChange={(v) => patch("catalog.ingester.media.retries", v)} />
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                    allowedFormats
                  </div>
                  <ChipsEditor value={cfg.catalog.ingester.media.allowedFormats} onChange={(arr) => patch("catalog.ingester.media.allowedFormats", arr)} placeholder="jpg" />
                </div>
                <div style={{ marginTop: 10, maxWidth: 320 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    queue
                  </div>
                  <TextInput value={cfg.catalog.ingester.media.queue} onChange={(v) => patch("catalog.ingester.media.queue", v)} placeholder="media" />
                </div>
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Indexer / Search" hint="shards/replicas, rate/min, partial/full reindex, поля індексу.">
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, maxWidth: 720 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    shards
                  </div>
                  <NumberInput value={cfg.catalog.indexer.shards} min={1} max={200} onChange={(v) => patch("catalog.indexer.shards", v)} />
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    replicas
                  </div>
                  <NumberInput value={cfg.catalog.indexer.replicas} min={0} max={10} onChange={(v) => patch("catalog.indexer.replicas", v)} />
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    ratePerMin
                  </div>
                  <NumberInput value={cfg.catalog.indexer.ratePerMin} min={0} max={10000000} step={100} onChange={(v) => patch("catalog.indexer.ratePerMin", v)} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    reindexMode
                  </div>
                  <Select
                    value={cfg.catalog.indexer.reindexMode}
                    onChange={(v) => patch("catalog.indexer.reindexMode", v)}
                    options={[
                      { value: "partial", label: "partial" },
                      { value: "full", label: "full" },
                    ]}
                  />
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    stopWordsProfile
                  </div>
                  <TextInput value={cfg.catalog.indexer.stopWordsProfile} onChange={(v) => patch("catalog.indexer.stopWordsProfile", v)} placeholder="default" />
                </div>
              </div>

              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                  indexedFields
                </div>
                <ChipsEditor value={cfg.catalog.indexer.indexedFields} onChange={(arr) => patch("catalog.indexer.indexedFields", arr)} placeholder="sku" />
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Data retention / audit" hint="Скільки тримати логи імпорту/помилок та аудит.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, maxWidth: 720 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  importLogsDays
                </div>
                <NumberInput value={cfg.catalog.retention.importLogsDays} min={0} max={3650} onChange={(v) => patch("catalog.retention.importLogsDays", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  importErrorsDays
                </div>
                <NumberInput value={cfg.catalog.retention.importErrorsDays} min={0} max={3650} onChange={(v) => patch("catalog.retention.importErrorsDays", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  auditDays
                </div>
                <NumberInput value={cfg.catalog.retention.auditDays} min={0} max={3650} onChange={(v) => patch("catalog.retention.auditDays", v)} />
              </div>
            </div>
          </FieldRow>
        </Card>

        {/* 7) Print farm */}
        <div id="printFarm" />
        <Card title="7) Виробництво / Print Farm" sub="Принтери, профілі, маршрутизація, SLA/тайм-аути">
          <FieldRow label="Принтери" hint="Маппінг принтерів, профілі сопел/матеріалів.">
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Назва</th>
                    <th>Профіль</th>
                    <th>Матеріал</th>
                    <th>Увімкнено</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(cfg.printFarm.printers || []).map((p, i) => (
                    <tr key={`${p.id}-${i}`}>
                      <td>
                        <input
                          value={p.id}
                          onChange={(e) => {
                            const next = [...cfg.printFarm.printers];
                            next[i] = { ...next[i], id: e.target.value };
                            patch("printFarm.printers", next);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          value={p.name}
                          onChange={(e) => {
                            const next = [...cfg.printFarm.printers];
                            next[i] = { ...next[i], name: e.target.value };
                            patch("printFarm.printers", next);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          value={p.profile}
                          onChange={(e) => {
                            const next = [...cfg.printFarm.printers];
                            next[i] = { ...next[i], profile: e.target.value };
                            patch("printFarm.printers", next);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          value={p.material}
                          onChange={(e) => {
                            const next = [...cfg.printFarm.printers];
                            next[i] = { ...next[i], material: e.target.value };
                            patch("printFarm.printers", next);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!p.enabled}
                          onChange={(e) => {
                            const next = [...cfg.printFarm.printers];
                            next[i] = { ...next[i], enabled: e.target.checked };
                            patch("printFarm.printers", next);
                          }}
                          style={{ width: 18, height: 18 }}
                        />
                      </td>
                      <td style={{ width: 1, whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          onClick={() => {
                            const next = cfg.printFarm.printers.filter((_, idx) => idx !== i);
                            patch("printFarm.printers", next);
                          }}
                        >
                          Видалити
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <button
                type="button"
                onClick={() => patch("printFarm.printers", [...(cfg.printFarm.printers || []), { id: "new", name: "New printer", profile: "fdm-0.4", material: "PLA", enabled: true }])}
              >
                Додати принтер
              </button>
            </div>
          </FieldRow>

          <FieldRow label="Маршрутизація задач" hint="Прості правила: яка група принтерів для якого матеріалу.">
            <div style={{ display: "grid", gap: 8 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                правила
              </div>
              <ChipsEditor
                value={(cfg.printFarm.routing.rules || []).map((r) => `${r.when} -> ${r.then}`)}
                onChange={(arr) => {
                  const rules = arr.map((line) => {
                    const [a, b] = String(line).split("->").map((x) => x.trim());
                    return { when: a || "", then: b || "" };
                  });
                  patch("printFarm.routing.rules", rules);
                }}
                placeholder="material=PLA -> printerGroup=fdm-pla"
              />
            </div>
          </FieldRow>

          <FieldRow label="SLA / тайм-аути" hint="Автопауза при error, сповіщення про простій/помилки.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, maxWidth: 720 }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <Toggle value={cfg.printFarm.sla.autoPauseOnError} onChange={(v) => patch("printFarm.sla.autoPauseOnError", v)} label="autoPauseOnError" />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  idleNotifyMinutes
                </div>
                <NumberInput value={cfg.printFarm.sla.idleNotifyMinutes} min={0} max={100000} onChange={(v) => patch("printFarm.sla.idleNotifyMinutes", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  errorNotifyMinutes
                </div>
                <NumberInput value={cfg.printFarm.sla.errorNotifyMinutes} min={0} max={100000} onChange={(v) => patch("printFarm.sla.errorNotifyMinutes", v)} />
              </div>
            </div>
          </FieldRow>
        </Card>

        {/* 8) Logistics */}
        <div id="logisticsPayments" />
        <Card title="8) Логістика та оплати" sub="Провайдери, ліміти, профілі webhooks, маппінг статусів, антифрод">
          <FieldRow label="Провайдери" hint="Увімкнути/вимкнути, rate-limit, профіль секретів.">
            <div style={{ display: "grid", gap: 12 }}>
              {Object.entries(cfg.logisticsPayments.providers).map(([name, p]) => (
                <div key={name} className="card" style={{ padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ fontWeight: 800 }}>{name}</div>
                    <Toggle value={p.enabled} onChange={(v) => patch(`logisticsPayments.providers.${name}.enabled`, v)} label="увімкнено" />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10, maxWidth: 720 }}>
                    <div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        rateLimitRps
                      </div>
                      <NumberInput value={p.rateLimitRps} min={0} max={1000} onChange={(v) => patch(`logisticsPayments.providers.${name}.rateLimitRps`, v)} />
                    </div>
                    <div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        профіль
                      </div>
                      <TextInput value={p.profile} onChange={(v) => patch(`logisticsPayments.providers.${name}.profile`, v)} placeholder="default" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </FieldRow>

          <FieldRow
            label="Маппінг статусів"
            hint="Відповідність зовнішніх статусів внутрішнім. Тут редагується як чернетка і застосовується кнопкою."
          >
            <div style={{ maxWidth: 720 }}>
              <TextArea
                value={statusMappingDraft}
                onChange={(v) => {
                  setStatusMappingDraft(v);
                  // live-validate, but do not patch
                  if (v.trim() === "") {
                    setStatusMappingError("Порожньо: очікується JSON-обʼєкт.");
                    return;
                  }
                  validateStatusMappingDraft(v);
                }}
                rows={10}
                placeholder='{"shipment":{"created":"new"}}'
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") applyStatusMappingDraft();
                }}
              />

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <button type="button" className="buttonPrimary" onClick={applyStatusMappingDraft}>
                  Застосувати
                </button>
                <button
                  type="button"
                  className="buttonSecondary"
                  onClick={() => {
                    setStatusMappingDraft(JSON.stringify(cfg.logisticsPayments.statusMapping, null, 2));
                    setStatusMappingError(null);
                  }}
                >
                  Відкотити
                </button>
                <div className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
                  Порада: Ctrl/⌘ + Enter — застосувати.
                </div>
              </div>

              {statusMappingError ? (
                <div style={{ marginTop: 8 }}>
                  <div className="errorBox">{statusMappingError}</div>
                </div>
              ) : null}
            </div>
          </FieldRow>

          <FieldRow label="Антифрод (акуратно)" hint="Пороги/правила перевірки замовлень.">
            <div style={{ display: "grid", gap: 10, maxWidth: 720 }}>
              <Toggle value={cfg.logisticsPayments.antifraud.enabled} onChange={(v) => patch("logisticsPayments.antifraud.enabled", v)} label="увімкнено" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    maxOrderValueUAH
                  </div>
                  <NumberInput
                    value={cfg.logisticsPayments.antifraud.maxOrderValueUAH}
                    min={0}
                    max={100000000}
                    step={100}
                    onChange={(v) => patch("logisticsPayments.antifraud.maxOrderValueUAH", v)}
                  />
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    requireManualReviewAboveUAH
                  </div>
                  <NumberInput
                    value={cfg.logisticsPayments.antifraud.requireManualReviewAboveUAH}
                    min={0}
                    max={100000000}
                    step={100}
                    onChange={(v) => patch("logisticsPayments.antifraud.requireManualReviewAboveUAH", v)}
                  />
                </div>
              </div>
            </div>
          </FieldRow>
        </Card>

        {/* 9) Webhooks */}
        <div id="webhooks" />
        <Card title="9) Вебхуки" sub="Retries/backoff, ідемпотентність, підписи, останні помилки, тестова подія">
          <FieldRow label="Політики" hint="Основні важелі надійності та безпеки вебхуків.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  retries
                </div>
                <NumberInput value={cfg.webhooks.policy.retries} min={0} max={100} onChange={(v) => patch("webhooks.policy.retries", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  backoffMs
                </div>
                <NumberInput value={cfg.webhooks.policy.backoffMs} min={0} max={3600000} step={100} onChange={(v) => patch("webhooks.policy.backoffMs", v)} />
              </div>
              <div style={{ display: "flex", alignItems: "center" }}>
                <Toggle value={cfg.webhooks.policy.idempotencyEnabled} onChange={(v) => patch("webhooks.policy.idempotencyEnabled", v)} label="idempotencyEnabled" />
              </div>
              <div style={{ display: "flex", alignItems: "center" }}>
                <Toggle value={cfg.webhooks.policy.signatureVerification} onChange={(v) => patch("webhooks.policy.signatureVerification", v)} label="signatureVerification" />
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Останні помилки" hint="Плейсхолдер (можна підключити до /api/webhooks/errors).">
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>час</th>
                    <th>джерело</th>
                    <th>повідомлення</th>
                  </tr>
                </thead>
                <tbody>
                  {(cfg.webhooks.recentErrors || []).length ? (
                    (cfg.webhooks.recentErrors || []).slice(0, 20).map((e, i) => (
                      <tr key={i}>
                        <td className="muted">{e.ts || "—"}</td>
                        <td>{e.source || "—"}</td>
                        <td>{e.message || "—"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="3" className="muted">
                        Даних поки немає.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </FieldRow>

          <FieldRow label="Надіслати тестову подію" hint="Опціонально: надіслати тестовий вебхук (якщо API реалізовано).">
            <button
              type="button"
              onClick={() =>
                doAction({
                  title: "Надіслати тестову подію",
                  description: "Надіслати тестову подію для перевірки траси.",
                  url: "/api/ops/webhooks/send-test",
                  body: { kind: "ping" },
                })
              }
            >
              надіслати тест
            </button>
          </FieldRow>
        </Card>

        {/* 10) Alerts */}
        <div id="alerts" />
        <Card title="10) Алерти та сповіщення" sub="Канали, правила, тихі години">
          <FieldRow label="Канали" hint="Telegram/Slack/Email/Webhook (профілі зберігаються на сервері).">
            <div style={{ display: "grid", gap: 12 }}>
              {Object.entries(cfg.alerts.channels).map(([name, c]) => (
                <div key={name} className="card" style={{ padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ fontWeight: 800 }}>{name}</div>
                    <Toggle value={c.enabled} onChange={(v) => patch(`alerts.channels.${name}.enabled`, v)} label="увімкнено" />
                  </div>
                  <div style={{ marginTop: 10, maxWidth: 360 }}>
                    <div className="muted" style={{ fontSize: 12 }}>
                      профіль
                    </div>
                    <TextInput value={c.profile} onChange={(v) => patch(`alerts.channels.${name}.profile`, v)} placeholder="default" />
                  </div>
                </div>
              ))}
            </div>
          </FieldRow>

          <FieldRow label="Правила" hint="Приклади: lag > X мс 5 хв, error rate, backlog, backup failed.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, maxWidth: 720 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  queueLagMs
                </div>
                <NumberInput value={cfg.alerts.rules.queueLagMs} min={0} max={3600000} step={500} onChange={(v) => patch("alerts.rules.queueLagMs", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  queueLagForMinutes
                </div>
                <NumberInput value={cfg.alerts.rules.queueLagForMinutes} min={0} max={10080} onChange={(v) => patch("alerts.rules.queueLagForMinutes", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  errorRatePct
                </div>
                <NumberInput value={cfg.alerts.rules.errorRatePct} min={0} max={100} step={0.1} onChange={(v) => patch("alerts.rules.errorRatePct", v)} />
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  indexerBacklog
                </div>
                <NumberInput value={cfg.alerts.rules.indexerBacklog} min={0} max={100000000} step={1000} onChange={(v) => patch("alerts.rules.indexerBacklog", v)} />
              </div>
              <div style={{ display: "flex", alignItems: "center" }}>
                <Toggle value={cfg.alerts.rules.backupFailed} onChange={(v) => patch("alerts.rules.backupFailed", v)} label="backupFailed" />
              </div>
            </div>
          </FieldRow>

          <FieldRow label="Тихі години" hint="Коли не турбувати (або тільки critical).">
            <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
              <Toggle value={cfg.alerts.quietHours.enabled} onChange={(v) => patch("alerts.quietHours.enabled", v)} label="увімкнено" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    початок
                  </div>
                  <TextInput value={cfg.alerts.quietHours.start} onChange={(v) => patch("alerts.quietHours.start", v)} placeholder="23:00" />
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    кінець
                  </div>
                  <TextInput value={cfg.alerts.quietHours.end} onChange={(v) => patch("alerts.quietHours.end", v)} placeholder="07:00" />
                </div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  часовий пояс
                </div>
                <TextInput value={cfg.alerts.quietHours.timezone} onChange={(v) => patch("alerts.quietHours.timezone", v)} placeholder="Europe/Kyiv" />
              </div>
            </div>
          </FieldRow>
        </Card>

        {/* 11) Security */}
        <div id="security" />
        <Card title="11) Безпека та доступ" sub="RBAC на дії, audit log змін">
          <FieldRow label="RBAC: хто може натискати «небезпечні» кнопки" hint="Списки ролей для операційних дій.">
            <div style={{ display: "grid", gap: 12, maxWidth: 720 }}>
              {Object.entries(cfg.security.rbac).map(([k, roles]) => (
                <div key={k}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {k}
                  </div>
                  <ChipsEditor value={roles} onChange={(arr) => patch(`security.rbac.${k}`, arr)} placeholder="admin" />
                </div>
              ))}
            </div>
          </FieldRow>

          <FieldRow label="Audit log" hint="Плейсхолдер. Пізніше можна підключити до /api/audit/recent.">
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>час</th>
                    <th>актор</th>
                    <th>дія</th>
                    <th>ціль</th>
                  </tr>
                </thead>
                <tbody>
                  {(cfg.security.audit.recent || []).map((x, i) => (
                    <tr key={i}>
                      <td className="muted">{x.ts}</td>
                      <td>{x.actor}</td>
                      <td>{x.action}</td>
                      <td>{x.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FieldRow>
        </Card>

        <div className="muted" style={{ fontSize: 12, paddingBottom: 16 }}>
          Примітка: зараз це “локальні” налаштування для UI. Коли будеш готовий — я підключу синхронізацію з API (GET/PUT) і застосування до Board/ops.
        </div>
      </div>
    </div>
  );
}
