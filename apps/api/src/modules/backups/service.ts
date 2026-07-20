import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// All paths/hosts are env-driven so the UI never has to hardcode them.
//  - host:        shop server that owns the data and runs backup.sh (192.168.0.135)
//  - destHost:    app server that stores the copies on its 240 GB SSD (192.168.0.139)
//  - retention:   copies older than this are pruned by backup.sh (≈3–4 weeks)
const cfg = {
  user: process.env.BACKUP_SSH_USER || "miha",
  host: process.env.BACKUP_SSH_HOST || "192.168.0.135",
  key: process.env.BACKUP_SSH_KEY || "/run/secrets/lite_forest_ops",
  projectRoot: process.env.BACKUP_REMOTE_PROJECT_ROOT || "/home/miha/app",
  script:
    process.env.BACKUP_REMOTE_SCRIPT || "/home/miha/app/ops/backups/backup.sh",
  checkScript:
    process.env.BACKUP_REMOTE_CHECK_SCRIPT ||
    "/home/miha/app/ops/backups/check-backup.sh",
  statusFile:
    process.env.BACKUP_REMOTE_STATUS_FILE ||
    "/mnt/fast_data/backups/lite-forest/state/backup-status.json",
  archivesDir:
    process.env.BACKUP_REMOTE_ARCHIVES_DIR ||
    "/mnt/fast_data/backups/lite-forest/archives",
  destHost: process.env.BACKUP_DEST_HOST || "192.168.0.139",
  destDisk: process.env.BACKUP_DEST_DISK || "SSD 240 GB",
  retentionDays: Number(process.env.BACKUP_RETENTION_DAYS || 28),
};

export function getBackupConfig() {
  return {
    sourceHost: cfg.host,
    destHost: cfg.destHost,
    destDisk: cfg.destDisk,
    retentionDays: cfg.retentionDays,
    archivesDir: cfg.archivesDir,
    statusFile: cfg.statusFile,
    script: cfg.script,
  };
}

// Tag an error so routes can surface its (operator-safe) message instead of the
// generic 502 we use for raw SSH/transport failures.
type ExposedError = Error & { statusCode?: number; expose?: boolean };

function exposeError(statusCode: number, message: string): ExposedError {
  const err = new Error(message) as ExposedError;
  err.statusCode = statusCode;
  err.expose = true;
  return err;
}

type BackupStatusRaw = {
  project?: string;
  status?: string;
  step?: string;
  message?: string;
  run_id?: string;
  run_dir?: string;
  log_file?: string;
  updated_at?: string;
};

// Canonical step keys match the UI's stage list 1:1 so the same `step` highlights
// the right row and the percent only ever moves forward. Aliases that backup.sh
// may emit are mapped onto the canonical percent.
const STEP_PERCENT: Record<string, number> = {
  lock: 5,
  preflight: 5,
  postgres: 15,
  uploads: 25,
  minio: 35,
  ingester: 45,
  stl_large: 55,
  stl_small: 65,
  config: 72,
  manifest: 78,
  checksum: 84,
  checksums: 84,
  remote: 92,
  "remote-sync": 92,
  retention: 97,
  done: 100,
};

function sshTarget() {
  return `${cfg.user}@${cfg.host}`;
}

function sshArgs(remoteCommand: string) {
  return [
    "-i",
    cfg.key,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    sshTarget(),
    remoteCommand,
  ];
}

async function runSsh(remoteCommand: string, timeoutMs = 15000) {
  const { stdout, stderr } = await execFileAsync("ssh", sshArgs(remoteCommand), {
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 4,
  });

  return {
    stdout: String(stdout || ""),
    stderr: String(stderr || ""),
  };
}

function idleProgress() {
  return {
    type: "backup",
    status: "idle",
    step: null,
    stage: null,
    percent: 0,
    message: "Резервное копирование сейчас не выполняется.",
    updatedAt: null,
    runId: null,
    runDir: null,
    logFile: null,
  };
}

function normalizeStatus(raw: BackupStatusRaw | null) {
  if (!raw) {
    return idleProgress();
  }

  const rawStatus = raw.status || "idle";
  const rawStep = raw.step || null;

  const status =
    rawStatus === "failed" ? "error" :
    rawStatus === "skipped" ? "idle" :
    rawStatus;

  const step =
    status === "success" ? "done" :
    status === "error" ? "error" :
    rawStep;

  const percent =
    status === "success" ? 100 :
    status === "error" ? 100 :
    (rawStep && STEP_PERCENT[rawStep]) || 0;

  return {
    type: "backup",
    status,
    step,
    // `stage` kept for backwards compatibility; mirrors the canonical step.
    stage: step,
    percent,
    message: raw.message || "Ожидание статуса от сервера.",
    updatedAt: raw.updated_at || null,
    runId: raw.run_id || null,
    runDir: raw.run_dir || null,
    logFile: raw.log_file || null,
  };
}

export async function getBackupStatus() {
  // A missing status file is a legitimate "no backup yet" idle state. Anything
  // else (permission denied, bad path) must surface — `cat || true` masked it.
  const file = cfg.statusFile;
  const command = `if [ ! -e '${file}' ]; then echo '__MISSING__'; exit 0; fi; cat '${file}'`;

  const { stdout } = await runSsh(command);
  const text = stdout.trim();

  if (!text || text === "__MISSING__") {
    return { progress: idleProgress() };
  }

  let raw: BackupStatusRaw;
  try {
    raw = JSON.parse(text) as BackupStatusRaw;
  } catch {
    throw exposeError(502, "Не удалось разобрать backup-status.json с сервера.");
  }

  return {
    progress: normalizeStatus(raw),
    raw,
  };
}

export async function runBackupNow() {
  // Verify the script is executable, start it detached, then wait briefly to
  // catch an immediate failure — so the operator never sees "started" for a
  // backup that never ran.
  const command = [
    `if [ ! -x '${cfg.script}' ]; then echo '__NO_SCRIPT__' >&2; exit 10; fi`,
    `cd '${cfg.projectRoot}' || { echo '__NO_CD__' >&2; exit 11; }`,
    `export BACKUP_RETENTION_DAYS='${cfg.retentionDays}'`,
    `log="$(mktemp)"`,
    `nohup '${cfg.script}' </dev/null >"$log" 2>&1 &`,
    `pid=$!`,
    `sleep 2`,
    `if kill -0 "$pid" 2>/dev/null; then echo "started pid=$pid"; else wait "$pid"; rc=$?; echo "__EARLY_EXIT__ rc=$rc" >&2; exit 12; fi`,
  ].join("\n");

  let stdout: string;
  try {
    ({ stdout } = await runSsh(command, 20000));
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code === 10) {
      throw exposeError(
        422,
        "Скрипт резервного копирования недоступен или не является исполняемым на сервере магазина."
      );
    }
    if (code === 11) {
      throw exposeError(
        422,
        "Не удалось перейти в каталог проекта на сервере магазина."
      );
    }
    if (code === 12) {
      throw exposeError(
        502,
        "Скрипт резервного копирования завершился сразу после запуска. Проверьте журнал на сервере."
      );
    }
    throw error;
  }

  if (!/started pid=/.test(stdout)) {
    throw exposeError(502, "Не удалось подтвердить запуск резервного копирования.");
  }

  return {
    ok: true,
    progress: {
      type: "backup",
      status: "running",
      step: "preflight",
      stage: "preflight",
      percent: 5,
      message: "Резервное копирование запущено.",
      updatedAt: new Date().toISOString(),
      runId: null,
      runDir: null,
      logFile: null,
    },
  };
}

export async function testRestoreLatest() {
  const command = [
    `if [ ! -x '${cfg.checkScript}' ]; then echo '__NO_CHECK__' >&2; exit 2; fi`,
    `'${cfg.checkScript}' '${cfg.archivesDir}/latest'`,
  ].join("\n");

  let stdout: string;
  try {
    ({ stdout } = await runSsh(command, 120000));
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code === 2) {
      throw exposeError(
        422,
        "Скрипт проверки резервной копии недоступен на сервере магазина."
      );
    }
    throw error;
  }

  return {
    ok: true,
    progress: {
      type: "restore",
      status: "success",
      step: "done",
      stage: "done",
      percent: 100,
      message: "Проверка последней резервной копии успешно завершена.",
      updatedAt: new Date().toISOString(),
    },
    output: stdout.slice(-4000),
  };
}

type BackupArchive = {
  id: string;
  name: string;
  createdAt: string | null;
  sizeBytes: number | null;
  path: string;
  isLatest: boolean;
};

export async function listBackups() {
  // Emit one TSV row per archive (dirs *and* the `latest` symlink) with mtime
  // epoch, content size and absolute path, so the UI shows real metadata.
  const dir = cfg.archivesDir;
  const command = [
    `if [ ! -d '${dir}' ]; then echo '__NO_DIR__'; exit 0; fi`,
    `find '${dir}' -mindepth 1 -maxdepth 1 \\( -type d -o -type l \\) -printf '%f\\n' | sort -r | head -50 | while IFS= read -r name; do`,
    `  [ -n "$name" ] || continue`,
    `  epoch="$(stat -L -c %Y '${dir}'/"$name" 2>/dev/null || echo 0)"`,
    `  bytes="$(du -sbL '${dir}'/"$name" 2>/dev/null | cut -f1)"`,
    `  printf '%s\\t%s\\t%s\\t%s\\n' "$name" "$epoch" "\${bytes:-0}" '${dir}'/"$name"`,
    `done`,
  ].join("\n");

  const { stdout } = await runSsh(command, 60000);
  const text = stdout.trim();

  if (!text || text === "__NO_DIR__") {
    return { backups: [] as BackupArchive[] };
  }

  const backups: BackupArchive[] = text
    .split("\n")
    .map((line) => line.split("\t"))
    .filter((cols) => cols[0])
    .map(([name, epoch, bytes, path]) => {
      const epochNum = Number(epoch);
      const sizeNum = Number(bytes);

      return {
        id: name,
        name,
        createdAt:
          Number.isFinite(epochNum) && epochNum > 0
            ? new Date(epochNum * 1000).toISOString()
            : null,
        sizeBytes: Number.isFinite(sizeNum) && sizeNum > 0 ? sizeNum : null,
        path: path || `${dir}/${name}`,
        isLatest: name === "latest",
      };
    });

  return { backups };
}
