import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const cfg = {
  user: process.env.BACKUP_SSH_USER || "miha",
  host: process.env.BACKUP_SSH_HOST || "192.168.0.135",
  key: process.env.BACKUP_SSH_KEY || "/run/secrets/lite_forest_ops",
  projectRoot: process.env.BACKUP_REMOTE_PROJECT_ROOT || "/home/miha/app",
  script: process.env.BACKUP_REMOTE_SCRIPT || "/home/miha/app/ops/backups/backup.sh",
  statusFile:
    process.env.BACKUP_REMOTE_STATUS_FILE ||
    "/mnt/fast_data/backups/lite-forest/state/backup-status.json",
  archivesDir:
    process.env.BACKUP_REMOTE_ARCHIVES_DIR ||
    "/mnt/fast_data/backups/lite-forest/archives",
};

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

const stageByStep: Record<string, { stage: string; percent: number }> = {
  preflight: { stage: "preparing", percent: 15 },
  postgres: { stage: "database", percent: 35 },
  uploads: { stage: "files", percent: 45 },
  minio: { stage: "files", percent: 55 },
  ingester: { stage: "files", percent: 60 },
  config: { stage: "files", percent: 65 },
  manifest: { stage: "verifying", percent: 70 },
  checksum: { stage: "verifying", percent: 75 },
  checksums: { stage: "verifying", percent: 75 },
  remote: { stage: "uploading", percent: 85 },
  "remote-sync": { stage: "uploading", percent: 85 },
  retention: { stage: "retention", percent: 95 },
  done: { stage: "done", percent: 100 },
  error: { stage: "error", percent: 100 },
  lock: { stage: "queued", percent: 5 },
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

function normalizeStatus(raw: BackupStatusRaw | null) {
  if (!raw) {
    return {
      type: "backup",
      status: "idle",
      stage: null,
      percent: 0,
      message: "Статус резервного копирования пока недоступен.",
      updatedAt: null,
      runId: null,
      runDir: null,
      logFile: null,
    };
  }

  const rawStatus = raw.status || "idle";
  const step = raw.step || null;
  const stageInfo = step ? stageByStep[step] : null;

  const status =
    rawStatus === "failed" ? "error" :
    rawStatus === "skipped" ? "idle" :
    rawStatus;

  const stage =
    status === "success" ? "done" :
    status === "error" ? "error" :
    stageInfo?.stage || step;

  const percent =
    status === "success" ? 100 :
    status === "error" ? 100 :
    stageInfo?.percent || 0;

  return {
    type: "backup",
    status,
    stage,
    percent,
    message: raw.message || "Ожидание статуса от сервера.",
    updatedAt: raw.updated_at || null,
    runId: raw.run_id || null,
    runDir: raw.run_dir || null,
    logFile: raw.log_file || null,
  };
}

export async function getBackupStatus() {
  const command = `cat '${cfg.statusFile}' 2>/dev/null || true`;
  const { stdout } = await runSsh(command);

  const text = stdout.trim();

  if (!text) {
    return {
      progress: normalizeStatus(null),
    };
  }

  try {
    const raw = JSON.parse(text) as BackupStatusRaw;

    return {
      progress: normalizeStatus(raw),
      raw,
    };
  } catch {
    return {
      progress: {
        type: "backup",
        status: "error",
        stage: "error",
        percent: 100,
        message: "Не удалось разобрать backup-status.json.",
        updatedAt: new Date().toISOString(),
      },
    };
  }
}

export async function runBackupNow() {
  const command = [
    `cd '${cfg.projectRoot}'`,
    `nohup '${cfg.script}' </dev/null >/dev/null 2>&1 &`,
    `echo started`,
  ].join(" && ");

  await runSsh(command, 10000);

  return {
    ok: true,
    progress: {
      type: "backup",
      status: "queued",
      stage: "queued",
      percent: 5,
      message: "Резервное копирование запущено.",
      updatedAt: new Date().toISOString(),
    },
  };
}

export async function testRestoreLatest() {
  const command = [
    `cd '${cfg.projectRoot}'`,
    `if [ -x ./ops/backups/check-backup.sh ]; then`,
    `./ops/backups/check-backup.sh '${cfg.archivesDir}/latest'`,
    `else`,
    `echo 'check-backup.sh not found' >&2`,
    `exit 2`,
    `fi`,
  ].join(" ");

  const { stdout } = await runSsh(command, 120000);

  return {
    ok: true,
    progress: {
      type: "restore",
      status: "success",
      stage: "done",
      percent: 100,
      message: "Проверка последней резервной копии успешно завершена.",
      updatedAt: new Date().toISOString(),
    },
    output: stdout.slice(-4000),
  };
}

export async function listBackups() {
  const command = [
    `find '${cfg.archivesDir}' -mindepth 1 -maxdepth 1 -type d -printf '%f\\n'`,
    `| sort -r`,
    `| head -50`,
  ].join(" ");

  const { stdout } = await runSsh(command);

  return {
    backups: stdout
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean),
  };
}