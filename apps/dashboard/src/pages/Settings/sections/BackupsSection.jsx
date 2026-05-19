// apps/dashboard/src/pages/settings/sections/BackupsSection.jsx
import React from "react";
import { api } from "../../../api/client.js";
import { Card, FieldRow, Toggle, NumberInput, Select, TextInput } from "../ui.jsx";
import styles from "../../Settings.module.css";

const includeLabels = {
  database: "База данных",
  uploads: "Загрузки",
  media: "Медиафайлы",
  config: "Конфигурация",
  logs: "Логи",
  cache: "Кэш",
};

const backupStages = [
  { key: "queued", label: "В очереди", percent: 5 },
  { key: "preparing", label: "Подготовка", percent: 15 },
  { key: "database", label: "База данных", percent: 35 },
  { key: "files", label: "Файлы", percent: 55 },
  { key: "verifying", label: "Проверка", percent: 75 },
  { key: "uploading", label: "Копирование на ПК", percent: 85 },
  { key: "retention", label: "Очистка старых копий", percent: 95 },
  { key: "done", label: "Готово", percent: 100 },
];

const restoreStages = [
  { key: "queued", label: "В очереди", percent: 5 },
  { key: "preparing", label: "Подготовка", percent: 15 },
  { key: "downloading", label: "Загрузка копии", percent: 30 },
  { key: "sandbox", label: "Песочница", percent: 50 },
  { key: "restoring", label: "Восстановление", percent: 70 },
  { key: "verifying", label: "Проверка", percent: 90 },
  { key: "done", label: "Готово", percent: 100 },
];

const statusLabels = {
  idle: "Нет активного процесса",
  queued: "Ожидает запуска",
  running: "Выполняется",
  success: "Завершено",
  error: "Ошибка",
};

function clampPercent(value) {
  const num = Number(value);

  if (!Number.isFinite(num)) return 0;
  if (num < 0) return 0;
  if (num > 100) return 100;

  return Math.round(num);
}

function formatProgressTime(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function BackupProgressPanel({ progress }) {
  const safeProgress =
    progress || {
      type: "backup",
      status: "idle",
      stage: null,
      percent: 0,
      message: "Резервное копирование сейчас не выполняется.",
      updatedAt: null,
    };

  const type = safeProgress.type === "restore" ? "restore" : "backup";
  const stages = type === "restore" ? restoreStages : backupStages;
  const currentStageKey = safeProgress.stage;
  const currentIndex = stages.findIndex((stage) => stage.key === currentStageKey);
  const currentStage = currentIndex >= 0 ? stages[currentIndex] : null;
  const percent = clampPercent(safeProgress.percent ?? currentStage?.percent ?? 0);
  const status = safeProgress.status || "idle";
  const statusLabel = statusLabels[status] || status;
  const updatedAt = formatProgressTime(safeProgress.updatedAt);

  return (
    <div className={styles.backupProgressCard}>
      <div className={styles.backupProgressHeader}>
        <div>
          <div className={styles.backupProgressEyebrow}>
            {type === "restore" ? "Тестовое восстановление" : "Резервное копирование"}
          </div>

          <div className={styles.backupProgressTitle}>
            {currentStage ? currentStage.label : statusLabel}
          </div>

          <div className={styles.backupProgressMeta}>
            {safeProgress.message || "Ожидание статуса от сервера."}
            {updatedAt ? ` Обновлено: ${updatedAt}` : ""}
          </div>
        </div>

        <div
          className={[
            styles.backupProgressBadge,
            status === "error" ? styles.backupProgressBadgeError : "",
            status === "success" ? styles.backupProgressBadgeSuccess : "",
          ].join(" ")}
        >
          {percent}%
        </div>
      </div>

      <div
        className={styles.backupProgressTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className={styles.backupProgressFill}
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol className={styles.backupProgressSteps}>
        {stages.map((stage, index) => {
          const isDone = currentIndex >= 0 && index < currentIndex;
          const isActive = index === currentIndex;

          return (
            <li
              key={stage.key}
              className={[
                styles.backupProgressStep,
                isDone ? styles.backupProgressStepDone : "",
                isActive ? styles.backupProgressStepActive : "",
              ].join(" ")}
            >
              <span className={styles.backupProgressDot}>
                {isDone ? "✓" : index + 1}
              </span>
              <span>{stage.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function BackupsSection({ cfg, patch, doAction }) {
  const [localProgress, setLocalProgress] = React.useState(null);

  const loadBackupStatus = React.useCallback(async () => {
    try {
      const result = await api.get("/api/ops/backup/status", {
        timeoutMs: 10000,
      });

      if (result?.progress) {
        setLocalProgress(result.progress);
      }
    } catch {
      setLocalProgress((prev) => ({
        ...(prev || {
          type: "backup",
          status: "idle",
          stage: null,
          percent: 0,
        }),
        status: "error",
        stage: "error",
        percent: 100,
        message: "Не удалось получить статус резервного копирования.",
        updatedAt: new Date().toISOString(),
      }));
    }
  }, []);

  React.useEffect(() => {
    loadBackupStatus();

    const timer = window.setInterval(loadBackupStatus, 5000);

    return () => window.clearInterval(timer);
  }, [loadBackupStatus]);

  const runProgressAction = async ({ action, progress }) => {
    setLocalProgress({
      ...progress,
      updatedAt: new Date().toISOString(),
    });

    try {
      const result = await Promise.resolve(doAction(action));

      if (result?.progress) {
        setLocalProgress(result.progress);
        window.setTimeout(loadBackupStatus, 1500);
        return;
      }

      setLocalProgress((prev) => ({
        ...prev,
        status: "running",
        percent: Math.max(Number(prev?.percent) || 0, 5),
        message: "Задача отправлена. Ожидается обновление статуса от сервера.",
        updatedAt: new Date().toISOString(),
      }));

      window.setTimeout(loadBackupStatus, 1500);
    } catch (error) {
      setLocalProgress((prev) => ({
        ...prev,
        status: "error",
        stage: "error",
        percent: 100,
        message: "Не удалось запустить действие.",
        updatedAt: new Date().toISOString(),
      }));
    }
  };

  const cronFromPreset = (preset) => {
    if (preset === "hourly") return "0 * * * *";
    if (preset === "daily") return "0 3 * * *";
    if (preset === "weekly") return "0 4 * * 0";

    return cfg.backups.cron;
  };

  return (
    <Card
      title="2) Резервные копии и хранилище"
      sub="Расписание, состав резервной копии, хранение, хранилище, ручные действия"
    >
      <FieldRow label="Расписание" hint="Готовый вариант или собственный cron.">
        <div className={`${styles.inputGroup} ${styles.max520}`}>
          <Select
            value={cfg.backups.schedulePreset}
            onChange={(v) => {
              patch("backups.schedulePreset", v);
              if (v !== "custom") patch("backups.cron", cronFromPreset(v));
            }}
            options={[
              { value: "hourly", label: "Каждый час" },
              { value: "daily", label: "Ежедневно" },
              { value: "weekly", label: "Еженедельно" },
              { value: "custom", label: "Пользовательский (cron)" },
            ]}
          />

          <TextInput
            value={cfg.backups.cron}
            onChange={(v) => patch("backups.cron", v)}
            placeholder="0 3 * * *"
          />
        </div>
      </FieldRow>

      <FieldRow
        label="Тип и состав резервной копии"
        hint="Полная/инкрементальная + что именно включать в резервную копию."
      >
        <div className={styles.inputGroup}>
          <Select
            value={cfg.backups.mode}
            onChange={(v) => patch("backups.mode", v)}
            options={[
              { value: "full", label: "Полная" },
              { value: "incremental", label: "Инкрементальная" },
            ]}
          />

          <div className={styles.inputGroup}>
            {Object.entries(cfg.backups.include).map(([k, v]) => (
              <Toggle
                key={k}
                value={v}
                onChange={(nv) => patch(`backups.include.${k}`, nv)}
                label={includeLabels[k] || k}
              />
            ))}
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Окно выполнения" hint="Чтобы не мешать работе в часы пик.">
        <div className={`${styles.inputGroup} ${styles.max520}`}>
          <Toggle
            value={cfg.backups.window.avoidPeak}
            onChange={(v) => patch("backups.window.avoidPeak", v)}
            label="Избегать часов пик"
          />

          <div className={styles.inputGrid2}>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                начало
              </div>

              <TextInput
                value={cfg.backups.window.start}
                onChange={(v) => patch("backups.window.start", v)}
                placeholder="02:00"
              />
            </div>

            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                конец
              </div>

              <TextInput
                value={cfg.backups.window.end}
                onChange={(v) => patch("backups.window.end", v)}
                placeholder="06:00"
              />
            </div>
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Хранение"
        hint="Сколько хранить ежедневных, еженедельных и ежемесячных копий."
      >
        <div className={`${styles.inputGrid3} ${styles.max520}`}>
          <div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              ежедневно
            </div>

            <NumberInput
              value={cfg.backups.retention.daily}
              min={0}
              max={3650}
              onChange={(v) => patch("backups.retention.daily", v)}
            />
          </div>

          <div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              еженедельно
            </div>

            <NumberInput
              value={cfg.backups.retention.weekly}
              min={0}
              max={520}
              onChange={(v) => patch("backups.retention.weekly", v)}
            />
          </div>

          <div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              ежемесячно
            </div>

            <NumberInput
              value={cfg.backups.retention.monthly}
              min={0}
              max={240}
              onChange={(v) => patch("backups.retention.monthly", v)}
            />
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Хранилище резервных копий"
        hint="S3/MinIO/файловая система. Ключи обычно хранятся на сервере — здесь только профиль."
      >
        <div className={`${styles.inputGroup} ${styles.max620}`}>
          <Select
            value={cfg.backups.storage.provider}
            onChange={(v) => patch("backups.storage.provider", v)}
            options={[
              { value: "minio", label: "MinIO" },
              { value: "s3", label: "S3" },
              { value: "filesystem", label: "Файловая система" },
            ]}
          />

          <div className={styles.inputGrid2}>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                Бакет (bucket)
              </div>

              <TextInput
                value={cfg.backups.storage.bucket}
                onChange={(v) => patch("backups.storage.bucket", v)}
                placeholder="backups"
              />
            </div>

            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                Путь (path)
              </div>

              <TextInput
                value={cfg.backups.storage.path}
                onChange={(v) => patch("backups.storage.path", v)}
                placeholder="fulfillment/"
              />
            </div>
          </div>

          <div className={styles.inputGrid2}>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                Профиль шифрования
              </div>

              <TextInput
                value={cfg.backups.storage.encryptionProfile}
                onChange={(v) => patch("backups.storage.encryptionProfile", v)}
                placeholder="server-managed"
              />
            </div>

            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                Профиль ключа
              </div>

              <TextInput
                value={cfg.backups.storage.keyProfile}
                onChange={(v) => patch("backups.storage.keyProfile", v)}
                placeholder="default"
              />
            </div>
          </div>
        </div>
      </FieldRow>

      <FieldRow
        label="Текущий процесс"
        hint="Показывает этап, процент выполнения и последнее состояние операции."
      >
        <BackupProgressPanel progress={localProgress || cfg.backups.progress} />
      </FieldRow>

      <FieldRow
        label="Ручные действия"
        hint="Пока что кнопки вызывают API-эндпоинты, если они реализованы."
      >
        <div className={styles.buttonGroup}>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() =>
              runProgressAction({
                progress: {
                  type: "backup",
                  status: "queued",
                  stage: "queued",
                  percent: 5,
                  message: "Запрос на резервное копирование отправляется.",
                },
                action: {
                  title: "Запустить резервное копирование сейчас",
                  description: "Немедленно запустить резервное копирование.",
                  url: "/api/ops/backup/run",
                  body: {
                    scope: cfg.backups.include,
                    mode: cfg.backups.mode,
                  },
                },
              })
            }
          >
            Запустить резервное копирование
          </button>

          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() =>
              runProgressAction({
                progress: {
                  type: "restore",
                  status: "queued",
                  stage: "queued",
                  percent: 5,
                  message: "Запрос на тестовое восстановление отправляется.",
                },
                action: {
                  title: "Тестовое восстановление",
                  description: "Тестовое восстановление в песочнице (если доступно).",
                  url: "/api/ops/backup/test-restore",
                  body: {
                    profile: cfg.backups.storage.keyProfile,
                  },
                },
              })
            }
          >
            Тестовое восстановление
          </button>
        </div>
      </FieldRow>
    </Card>
  );
}