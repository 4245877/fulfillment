// apps/dashboard/src/pages/settings/sections/BackupsSection.jsx
import React from "react";
import { api } from "../../../api/client.js";
import { Card, FieldRow } from "../ui.jsx";
import styles from "../../Settings.module.css";

const backupStages = [
  { key: "preflight", label: "Проверка условий", percent: 5 },
  { key: "postgres", label: "PostgreSQL", percent: 15 },
  { key: "uploads", label: "Uploads", percent: 25 },
  { key: "minio", label: "MinIO", percent: 35 },
  { key: "ingester", label: "Ingester data", percent: 45 },
  { key: "stl_large", label: "STL/3MF large", percent: 55 },
  { key: "stl_small", label: "STL/3MF small", percent: 65 },
  { key: "config", label: "Конфигурация", percent: 72 },
  { key: "manifest", label: "Manifest", percent: 78 },
  { key: "checksum", label: "Проверка sha256", percent: 84 },
  { key: "remote", label: "Копирование на ПК", percent: 92 },
  { key: "retention", label: "Очистка старых копий", percent: 97 },
  { key: "done", label: "Готово", percent: 100 },
];

const statusLabels = {
  idle: "Нет активного процесса",
  running: "Выполняется",
  success: "Завершено",
  failed: "Ошибка",
  error: "Ошибка",
  skipped: "Пропущено",
};

function clampPercent(value) {
  const num = Number(value);

  if (!Number.isFinite(num)) return 0;
  if (num < 0) return 0;
  if (num > 100) return 100;

  return Math.round(num);
}

function formatDateTime(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatBytes(value) {
  const num = Number(value);

  if (!Number.isFinite(num) || num <= 0) return "—";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = num;
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function normalizeProgress(raw) {
  if (!raw) {
    return {
      status: "idle",
      step: null,
      percent: 0,
      message: "Сейчас всё тихо — резервное копирование не выполняется.",
      updatedAt: null,
      runId: null,
      runDir: null,
      logFile: null,
    };
  }

  if (raw.progress) {
    return normalizeProgress(raw.progress);
  }

  const step = raw.step || raw.stage || null;
  const status = raw.status === "failed" ? "error" : raw.status || "idle";
  const stage = backupStages.find((item) => item.key === step);

  let percent = clampPercent(raw.percent ?? stage?.percent ?? 0);

  if (status === "success") percent = 100;
  if (status === "error") percent = 100;

  return {
    status,
    step,
    percent,
    message: raw.message || "Жду ответа сервера…",
    updatedAt: raw.updated_at || raw.updatedAt || null,
    runId: raw.run_id || raw.runId || null,
    runDir: raw.run_dir || raw.runDir || null,
    logFile: raw.log_file || raw.logFile || null,
  };
}

function normalizeArchiveList(raw) {
  const items = Array.isArray(raw)
    ? raw
    : raw?.archives || raw?.backups || raw?.items || [];

  return items.map((item) => {
    if (typeof item === "string") {
      return {
        id: item,
        name: item,
        createdAt: null,
        sizeBytes: null,
        path: null,
        isLatest: item === "latest",
      };
    }

    return {
      id: item.run_id || item.id || item.name || item.path,
      name: item.run_id || item.name || item.id || "backup",
      createdAt: item.created_at || item.createdAt || item.mtime || null,
      sizeBytes: item.size_bytes || item.sizeBytes || item.size || null,
      path: item.path || item.run_dir || item.runDir || null,
      isLatest:
        item.isLatest === true ||
        item.is_latest === true ||
        item.name === "latest",
    };
  });
}

async function runPostAction(doAction, action) {
  if (typeof doAction === "function") {
    return doAction(action);
  }

  if (typeof api.post === "function") {
    return api.post(action.url, action.body || {}, {
      timeoutMs: action.timeoutMs || 10000,
    });
  }

  throw new Error("Обработчик POST-действия недоступен");
}

function BackupProgressPanel({ progress }) {
  const currentIndex = backupStages.findIndex((stage) => stage.key === progress.step);
  const currentStage = currentIndex >= 0 ? backupStages[currentIndex] : null;

  const statusLabel = statusLabels[progress.status] || progress.status;
  const updatedAt = formatDateTime(progress.updatedAt);

  return (
    <div className={styles.backupProgressCard}>
      <div className={styles.backupProgressHeader}>
        <div>
          <div className={styles.backupProgressEyebrow}>
            Резервное копирование
          </div>

          <div className={styles.backupProgressTitle}>
            {currentStage ? currentStage.label : statusLabel}
          </div>

          <div className={styles.backupProgressMeta}>
            {progress.message}
            {progress.updatedAt ? ` Обновлено: ${updatedAt}` : ""}
          </div>

          {progress.runId ? (
            <div className={styles.backupProgressMeta}>
              ID запуска: {progress.runId}
            </div>
          ) : null}
        </div>

        <div
          className={[
            styles.backupProgressBadge,
            progress.status === "error" ? styles.backupProgressBadgeError : "",
            progress.status === "success" ? styles.backupProgressBadgeSuccess : "",
          ].join(" ")}
        >
          {progress.percent}%
        </div>
      </div>

      <div
        className={styles.backupProgressTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
      >
        <div
          className={styles.backupProgressFill}
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      <ol className={styles.backupProgressSteps}>
        {backupStages.map((stage, index) => {
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

const DEFAULT_INCLUDES = [
  "Товары и база данных",
  "Изображения",
  "STL / 3MF файлы",
  "Данные пользователей",
];

function BackupContents({ includes }) {
  const items = Array.isArray(includes) && includes.length ? includes : DEFAULT_INCLUDES;

  return (
    <div className={styles.inputGroup}>
      {items.map((item) => (
        <div key={item}>{item}</div>
      ))}
    </div>
  );
}

function BackupRoute({ backups, serverConfig }) {
  const source = backups?.source || {};
  const destination = backups?.destination || {};
  const retentionDays = serverConfig?.retentionDays ?? backups?.retentionDays;

  const sourceHost = serverConfig?.sourceHost || source.host || "—";
  const destHost = serverConfig?.destHost || destination.host || "—";
  const destDisk = serverConfig?.destDisk || destination.disk || "";

  return (
    <div className={styles.inputGroup}>
      <div>
        Откуда: {source.label ? `${source.label} ` : ""}({sourceHost})
      </div>
      <div>
        Куда: {destination.label ? `${destination.label} ` : ""}({destHost})
        {destDisk ? ` · ${destDisk}` : ""}
      </div>
      <div>Запуск: только вручную, без расписания</div>
      <div>
        Хранение: автоматическое удаление копий старше{" "}
        {retentionDays ? `${retentionDays} дней (≈3–4 недели)` : "настроенного срока"}
      </div>
      {serverConfig?.archivesDir ? (
        <div>Каталог архивов: {serverConfig.archivesDir}</div>
      ) : null}
    </div>
  );
}

function ArchiveList({ archives }) {
  if (!archives.length) {
    return <div className="text-muted">Список резервных копий ещё не загружен.</div>;
  }

  return (
    <div className={styles.inputGroup}>
      {archives.map((archive) => (
        <div
          key={archive.id}
          style={{
            display: "grid",
            gap: 4,
            padding: "10px 12px",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: 12,
          }}
        >
          <strong>
            {archive.name}
            {archive.isLatest ? " · latest" : ""}
          </strong>

          <span className="text-muted">
            Дата: {formatDateTime(archive.createdAt)}
          </span>

          <span className="text-muted">
            Размер: {formatBytes(archive.sizeBytes)}
          </span>

          {archive.path ? (
            <span className="text-muted">
              Путь: {archive.path}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function BackupsSection({ cfg, doAction }) {
  const [progress, setProgress] = React.useState(() => normalizeProgress(null));
  const [archives, setArchives] = React.useState([]);
  const [isBusy, setIsBusy] = React.useState(false);
  const [listError, setListError] = React.useState(null);
  const [serverConfig, setServerConfig] = React.useState(null);

  // Guard against overlapping polls: each request opens an SSH connection, so a
  // slow reply must not let the next interval tick stack a second one on top.
  const statusInFlight = React.useRef(false);
  const listInFlight = React.useRef(false);

  const backups = cfg?.backups;

  const loadBackupStatus = React.useCallback(async () => {
    if (statusInFlight.current) return;
    statusInFlight.current = true;

    try {
      const result = await api.get("/api/ops/backup/status", {
        timeoutMs: 10000,
      });

      setProgress(normalizeProgress(result));
    } catch {
      setProgress((prev) => ({
        ...prev,
        status: "error",
        step: "error",
        percent: 100,
        message: "Мне не удалось узнать состояние резервного копирования. Я попробую ещё раз.",
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      statusInFlight.current = false;
    }
  }, []);

  const loadBackupList = React.useCallback(async () => {
    if (listInFlight.current) return;
    listInFlight.current = true;

    try {
      const result = await api.get("/api/ops/backup/list", {
        timeoutMs: 15000,
      });

      setArchives(normalizeArchiveList(result));
      setListError(null);
    } catch {
      setListError("Мне не удалось загрузить список резервных копий. Попробуйте, пожалуйста, чуть позже.");
    } finally {
      listInFlight.current = false;
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    api
      .get("/api/ops/backup/config", { timeoutMs: 10000 })
      .then((result) => {
        if (!cancelled) setServerConfig(result || null);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    loadBackupStatus();
    loadBackupList();

    // Status is cheap and polled often; the archive list runs `du` over large
    // directories, so it refreshes less frequently.
    const statusTimer = window.setInterval(loadBackupStatus, 5000);
    const listTimer = window.setInterval(loadBackupList, 30000);

    return () => {
      window.clearInterval(statusTimer);
      window.clearInterval(listTimer);
    };
  }, [loadBackupStatus, loadBackupList]);

  const runBackup = async () => {
    setIsBusy(true);

    setProgress({
      status: "running",
      step: "preflight",
      percent: 5,
      message: "Начинаю резервное копирование — я позабочусь, чтобы всё было сохранено.",
      updatedAt: new Date().toISOString(),
      runId: null,
      runDir: null,
      logFile: null,
    });

    try {
      const result = await runPostAction(doAction, {
        title: "Запустить резервное копирование",
        description: "Запустить резервное копирование на сервере магазина.",
        url: "/api/ops/backup/run",
        body: {},
        timeoutMs: 15000,
      });

      setProgress(normalizeProgress(result?.progress || result));
      window.setTimeout(loadBackupStatus, 1500);
      window.setTimeout(loadBackupList, 2500);
    } catch {
      setProgress((prev) => ({
        ...prev,
        status: "error",
        step: "error",
        percent: 100,
        message: "Мне не удалось запустить резервное копирование. Проверьте, пожалуйста, соединение с сервером.",
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      setIsBusy(false);
    }
  };

  const checkLatestBackup = async () => {
    setIsBusy(true);

    setProgress((prev) => ({
      ...prev,
      status: "running",
      step: "checksum",
      percent: Math.max(prev.percent || 0, 84),
      message: "Я проверяю последнюю резервную копию — это может занять минуту.",
      updatedAt: new Date().toISOString(),
    }));

    try {
      const result = await runPostAction(doAction, {
        title: "Проверить последнюю резервную копию",
        description: "Запустить проверку для последней копии (latest).",
        url: "/api/ops/backup/test-restore",
        body: {},
        timeoutMs: 130000,
      });

      setProgress(normalizeProgress(result?.progress || result));
      window.setTimeout(loadBackupStatus, 1500);
    } catch {
      setProgress((prev) => ({
        ...prev,
        status: "error",
        step: "error",
        percent: 100,
        message: "Мне не удалось запустить проверку последней копии. Попробуйте, пожалуйста, ещё раз.",
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Card
      title="Резервные копии"
      sub="Ручной запуск, проверка, статус и список архивов Lite Forest"
    >
      <FieldRow
        label="Что входит в резервную копию"
        hint="Состав соответствует backup.sh на сервере магазина."
      >
        <BackupContents includes={backups?.includes} />
      </FieldRow>

      <FieldRow
        label="Откуда / куда и хранение"
        hint="Хосты, диск назначения и срок хранения берутся из конфигурации API."
      >
        <BackupRoute backups={backups} serverConfig={serverConfig} />
      </FieldRow>

      <FieldRow
        label="Текущий статус"
        hint="Считывается из status-файла резервного копирования через API."
        wide
      >
        <BackupProgressPanel progress={progress} />
      </FieldRow>

      <FieldRow
        label="Ручные действия"
        hint="Кнопки запускают реальные серверные скрипты через backend API."
      >
        <div className={styles.buttonGroup}>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            disabled={isBusy}
            onClick={runBackup}
          >
            Запустить резервное копирование
          </button>

          <button
            className="btn btn-secondary btn-sm"
            type="button"
            disabled={isBusy}
            onClick={checkLatestBackup}
          >
            Проверить latest
          </button>

          <button
            className="btn btn-secondary btn-sm"
            type="button"
            disabled={isBusy}
            onClick={() => {
              loadBackupStatus();
              loadBackupList();
            }}
          >
            Обновить
          </button>
        </div>
      </FieldRow>

      <FieldRow
        label="Архивы"
        wide
        hint={
          serverConfig?.archivesDir
            ? `Резервные копии из ${serverConfig.archivesDir}.`
            : "Резервные копии из каталога архивов на сервере."
        }
      >
        {listError ? (
          <div className="text-muted">{listError}</div>
        ) : (
          <ArchiveList archives={archives} />
        )}
      </FieldRow>
    </Card>
  );
}