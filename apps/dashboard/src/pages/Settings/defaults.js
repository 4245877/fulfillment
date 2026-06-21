export const STORAGE_KEY = "fulfillment.settings.v1";

export const DEFAULTS = {
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
    // Ручний запуск, без розкладу. Копії, старші за retentionDays, прибирає
    // backup.sh на сервері магазину. Шляхи/хости приходять з /api/ops/backup/config.
    manualOnly: true,
    retentionDays: 28, // ≈3–4 тижні

    includes: [
      "Товари та база даних",
      "Зображення",
      "STL / 3MF файли",
      "Дані користувачів",
    ],

    source: {
      host: "192.168.0.135",
      label: "Сервер магазину",
    },

    destination: {
      host: "192.168.0.139",
      disk: "SSD 240 GB",
      label: "Сервер застосунку",
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
      recent: [
        {
          ts: "—",
          actor: "—",
          action: "—",
          target: "—",
        },
      ],
    },
  },
};