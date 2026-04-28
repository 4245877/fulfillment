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
      {
        id: "ender3-v3-ke",
        name: "Creality Ender 3 V3 KE",
        protocol: "moonraker",
        host: "192.168.0.141",
        port: 80,
        profile: "fdm-0.4",
        material: "PLA / PETG / TPU",
        enabled: true,
      },
      {
        id: "creality-k2",
        name: "Creality K2",
        protocol: "moonraker",
        host: "192.168.0.132",
        port: 80,
        profile: "fdm-0.4",
        material: "PLA / PETG / ABS / ASA",
        enabled: true,
      },
      {
        id: "bambu-a1-combo",
        name: "Bambu Lab A1 Combo",
        protocol: "bambu",
        host: "192.168.0.187",
        port: 8883,
        profile: "bambu-a1-combo-0.4",
        material: "PLA / PETG / TPU",
        enabled: true,
      },
    ],
    routing: {
      rules: [
        { when: "material=PLA", then: "printer=ender3-v3-ke,creality-k2,bambu-a1-combo" },
        { when: "material=PETG", then: "printer=ender3-v3-ke,creality-k2,bambu-a1-combo" },
        { when: "multicolor=true", then: "printer=bambu-a1-combo" },
        { when: "material=ABS", then: "printer=creality-k2" },
        { when: "material=ASA", then: "printer=creality-k2" },
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