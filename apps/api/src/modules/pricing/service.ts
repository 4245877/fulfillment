import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { parseDocument, type Document } from "yaml";

const execFileAsync = promisify(execFile);

// Pricing config lives on the same host/account that backups already reach over
// SSH, so we reuse the BACKUP_SSH_* connection settings here.
const cfg = {
  user: process.env.BACKUP_SSH_USER || "miha",
  host: process.env.BACKUP_SSH_HOST || "192.168.0.135",
  key: process.env.BACKUP_SSH_KEY || "/run/secrets/lite_forest_ops",
  file:
    process.env.PRICING_REMOTE_FILE ||
    "/home/miha/app/services/ingester/data/pricing.yml",
};

function sshArgs(remoteCommand: string) {
  return [
    "-i",
    cfg.key,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    `${cfg.user}@${cfg.host}`,
    remoteCommand,
  ];
}

async function runSsh(remoteCommand: string, timeoutMs = 15000) {
  const { stdout, stderr } = await execFileAsync("ssh", sshArgs(remoteCommand), {
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 8,
  });

  return { stdout: String(stdout || ""), stderr: String(stderr || "") };
}

// execFile (async) has no stdin support, so we spawn ssh and pipe the new file
// contents through its stdin for the write path.
function runSshWithInput(
  remoteCommand: string,
  input: string,
  timeoutMs = 20000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", sshArgs(remoteCommand), {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ssh write timed out"));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(`ssh write exited with code ${code}: ${stderr.slice(0, 300)}`)
        );
      }
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Walks the previous (parsed-from-file) tree and the incoming tree, mutating the
// YAML Document in place so that only changed/added/removed nodes are touched.
// Untouched nodes keep their original formatting and — importantly — comments.
function applyDiff(
  doc: Document,
  oldValue: unknown,
  newValue: unknown,
  path: Array<string | number>
) {
  const oldKeys = isPlainObject(oldValue) ? Object.keys(oldValue) : [];
  const newKeys = isPlainObject(newValue) ? Object.keys(newValue) : [];

  for (const key of oldKeys) {
    if (!newKeys.includes(key)) {
      doc.deleteIn([...path, key]);
    }
  }

  for (const key of newKeys) {
    const nextPath = [...path, key];
    const oldChild = isPlainObject(oldValue)
      ? (oldValue as Record<string, unknown>)[key]
      : undefined;
    const newChild = (newValue as Record<string, unknown>)[key];

    if (!oldKeys.includes(key)) {
      // Brand-new key: set the whole subtree (scalar or nested object) at once.
      doc.setIn(nextPath, newChild);
    } else if (isPlainObject(oldChild) && isPlainObject(newChild)) {
      applyDiff(doc, oldChild, newChild, nextPath);
    } else if (!deepEqual(oldChild, newChild)) {
      doc.setIn(nextPath, newChild);
    }
  }
}

/**
 * Pure transform: given the current pricing.yml text and the desired tree,
 * returns the new YAML text with edits/additions/removals applied while keeping
 * comments and formatting of everything that did not change.
 */
export function applyPricingChanges(currentText: string, newTree: unknown): string {
  const doc = parseDocument(currentText);

  if (doc.errors.length > 0) {
    throw new Error(`pricing.yml is not valid YAML: ${doc.errors[0].message}`);
  }

  if (!isPlainObject(newTree)) {
    throw new Error("Invalid pricing payload: root must be an object");
  }

  if (Object.keys(newTree).length === 0) {
    throw new Error("Refusing to write an empty pricing config");
  }

  const currentObj = (doc.toJS() ?? {}) as Record<string, unknown>;

  applyDiff(doc, currentObj, newTree, []);

  const out = doc.toString();

  // Sanity check: the serialized result must round-trip as valid YAML.
  const verify = parseDocument(out);

  if (verify.errors.length > 0) {
    throw new Error("Refusing to write: serialized pricing.yml is invalid");
  }

  return out;
}

export type PricingFile = {
  path: string;
  raw: string;
  tree: unknown;
  hash: string;
};

export async function readPricing(): Promise<PricingFile> {
  const { stdout } = await runSsh(`cat '${cfg.file}'`);
  const raw = stdout;

  if (!raw.trim()) {
    throw new Error("pricing.yml is empty or could not be read");
  }

  const doc = parseDocument(raw);

  if (doc.errors.length > 0) {
    throw new Error(`pricing.yml is not valid YAML: ${doc.errors[0].message}`);
  }

  return {
    path: cfg.file,
    raw,
    tree: doc.toJS() ?? {},
    hash: sha256(raw),
  };
}

export async function writePricing(
  newTree: unknown,
  baseHash?: string
): Promise<{ ok: true; path: string; raw: string; tree: unknown; hash: string }> {
  const current = await readPricing();

  // Optimistic concurrency: refuse to clobber edits made on the server since the
  // client loaded the file.
  if (baseHash && baseHash !== current.hash) {
    const err = new Error(
      "pricing.yml was changed on the server since it was loaded. Reload and try again."
    ) as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  const newText = applyPricingChanges(current.raw, newTree);

  // No-op write guard: nothing to do if the result is byte-identical.
  if (newText !== current.raw) {
    // Write atomically: keep a single rolling .bak, stream the new content into a
    // temp file, copy the original permissions, then move it into place.
    const remoteCommand = [
      "set -e",
      `f='${cfg.file}'`,
      'tmp="$f.tmp.$$"',
      'cp -p "$f" "$f.bak" 2>/dev/null || true',
      'cat > "$tmp"',
      'chmod --reference="$f" "$tmp" 2>/dev/null || true',
      'mv -f "$tmp" "$f"',
    ].join("; ");

    await runSshWithInput(remoteCommand, newText, 20000);
  }

  const verify = parseDocument(newText);

  return {
    ok: true,
    path: cfg.file,
    raw: newText,
    tree: verify.toJS() ?? {},
    hash: sha256(newText),
  };
}
