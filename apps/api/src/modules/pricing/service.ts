import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  isMap,
  isScalar,
  parseDocument,
  stringify,
  visit,
  type Document,
  type Scalar,
  type YAMLMap,
} from "yaml";

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

// ---------------------------------------------------------------------------
// Surgical, text-level patching.
//
// The previous implementation re-serialized the whole YAML Document via
// `doc.toString()`. The `yaml` library preserves comment *text* but not the
// hand-aligned whitespace in front of `#` (a column of inline comments collapses
// to a single space), so editing one field reflowed comment alignment across the
// ENTIRE file — breaking the "untouched lines stay byte-for-byte" promise.
//
// Instead we compute a minimal set of text splices from the parsed node ranges
// and apply them to the original source, so any line we did not touch is left
// exactly as it was (comments, alignment and all). Anything we cannot express as
// a safe splice throws `SurgicalFallback`, and we fall back to the document
// rewrite (correct data, possibly reflowed) rather than risk corruption.
// ---------------------------------------------------------------------------

type Splice = { start: number; end: number; text: string };

class SurgicalFallback extends Error {}

function scalarKeyName(key: unknown): string {
  if (key && typeof key === "object" && "value" in key) {
    return String((key as { value: unknown }).value);
  }
  return String(key);
}

// ---------------------------------------------------------------------------
// Number formatting hints (issue #1).
//
// `doc.toJS()` turns `6.00` / `40.0` / `0.00` into plain JS numbers, so the
// editor would show `6` / `40` / `0` and the operator sees something other than
// what is in the file. We can't carry that precision in a JS number, so we ship
// a side map of `JSON.stringify(path) -> original source text` for every number
// scalar whose source differs from its canonical `String(value)`. The client
// uses it for *display only* (and drops it the moment the value is edited), so
// the data round-trips unchanged while the file's representation is honoured.
// ---------------------------------------------------------------------------
export type NumberFormats = Record<string, string>;

export function collectNumberFormats(
  node: unknown,
  path: string[],
  out: NumberFormats
): void {
  if (isMap(node)) {
    for (const pair of (node as YAMLMap).items) {
      collectNumberFormats(pair.value, [...path, scalarKeyName(pair.key)], out);
    }
    return;
  }
  // Arrays are edited as raw JSON in the UI, so per-element formatting is never
  // looked up — only scalars reachable by an object path matter here.
  if (isScalar(node)) {
    const value = (node as Scalar).value;
    const source = (node as Scalar).source;
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      typeof source === "string" &&
      source !== String(value)
    ) {
      out[JSON.stringify(path)] = source;
    }
  }
}

// Validation errors carry an HTTP status so the route layer can answer with a
// precise 4xx instead of a blanket 502 (which should mean "the SSH upstream
// itself failed", not "the operator sent something we won't write") — issue #2.
export type CodedError = Error & { statusCode?: number };
export function codedError(message: string, statusCode: number): CodedError {
  const err = new Error(message) as CodedError;
  err.statusCode = statusCode;
  return err;
}

// Keys that pollute Object.prototype or confuse downstream YAML consumers.
// Rejected on write at any depth — defence in depth, the client blocks them too
// (issue #10).
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function assertNoUnsafeKeys(node: unknown, path: string[] = []): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) =>
      assertNoUnsafeKeys(item, [...path, String(index)])
    );
    return;
  }
  if (isPlainObject(node)) {
    for (const key of Object.keys(node)) {
      if (UNSAFE_KEYS.has(key)) {
        const where = [...path, key].join(".");
        throw codedError(`Refusing to write: unsafe key "${key}" at ${where}`, 400);
      }
      assertNoUnsafeKeys((node as Record<string, unknown>)[key], [...path, key]);
    }
  }
}

// YAML anchors/aliases and `<<` merge keys are flattened by `toJS()` and would be
// expanded (and duplicated) on save, silently rewriting the file. We can't yet
// preserve them surgically. Detection walks the parsed AST (never the raw text),
// so `"<<"` inside a string value or `&anchor` inside a comment never trips a
// false positive (issue #9). Returns a human-readable reason, or null.
export function detectAnchors(doc: Document): string | null {
  let problem: string | null = null;

  visit(doc, {
    Alias() {
      problem = "псевдоніми (*alias)";
      return visit.BREAK;
    },
    Pair(_, pair) {
      const key = pair.key as { value?: unknown } | null;
      if (key && key.value === "<<") {
        problem = "ключі злиття (<<)";
        return visit.BREAK;
      }
      return undefined;
    },
    Node(_, node) {
      if ((node as { anchor?: string }).anchor) {
        problem = "якорі (&anchor)";
        return visit.BREAK;
      }
      return undefined;
    },
  });

  return problem;
}

// Refuse to write a file we cannot round-trip safely. Reading stays allowed so
// the operator can still inspect it (the read path surfaces a read-only banner).
function assertNoAnchors(doc: Document): void {
  const problem = detectAnchors(doc);
  if (problem) {
    throw codedError(
      `Refusing to write: pricing.yml uses YAML ${problem}, which the editor cannot preserve yet. Edit this file by hand.`,
      422
    );
  }
}

// Serialize a scalar (or inline array/object) to a single-line YAML fragment,
// delegating quoting rules to the library so e.g. the string "0.2" stays quoted.
function serializeInline(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return stringify(value).replace(/\n+$/, "");
  if (Array.isArray(value)) {
    return `[${value.map(serializeInline).join(", ")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return `{ ${entries
    .map(([k, v]) => `${serializeInline(k)}: ${serializeInline(v)}`)
    .join(", ")} }`;
}

// Serialize an object as an indented YAML block (for newly-added keys).
function serializeBlock(obj: Record<string, unknown>, indent: string): string {
  const body = stringify(obj, { indent: 2, lineWidth: 0 }).replace(/\n$/, "");
  return body
    .split("\n")
    .map((line) => (line ? indent + line : line))
    .join("\n");
}

function lineStartOf(src: string, offset: number): number {
  return src.lastIndexOf("\n", offset) + 1;
}

// Offset just after a pair's final line. Block collections already carry the
// trailing newline in range[1]; scalars stop before it (and before any inline
// comment), so for those we extend to the end of the line.
function endOfPairLine(
  src: string,
  pair: { key: unknown; value: unknown }
): number {
  const keyRange = (pair.key as { range?: [number, number, number] }).range;
  const valueRange = (pair.value as { range?: [number, number, number] } | null)?.range;
  let end = valueRange ? valueRange[1] : keyRange![1];
  if (src[end - 1] !== "\n") {
    const nl = src.indexOf("\n", end);
    end = nl === -1 ? src.length : nl + 1;
  }
  return end;
}

// Walks old (parsed-from-file) vs new tree for one map node, pushing splices.
function diffMap(
  node: unknown,
  src: string,
  edits: Splice[],
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>
): void {
  if (!isMap(node)) throw new SurgicalFallback("expected a block map node");

  const map = node as YAMLMap;
  const oldKeys = Object.keys(oldValue);
  const newKeys = Object.keys(newValue);
  const oldSet = new Set(oldKeys);
  const newSet = new Set(newKeys);

  const removed = oldKeys.filter((k) => !newSet.has(k));
  const added = newKeys.filter((k) => !oldSet.has(k));

  const findPair = (key: string) =>
    map.items.find((pair) => scalarKeyName(pair.key) === key);

  // Rename detection: a removed key whose value deep-equals an added key's value
  // is treated as an in-place rename (replace the key text only, keeping the
  // value subtree — and all its comments — byte-for-byte).
  const renames = new Map<string, string>();
  const consumedAdds = new Set<string>();
  for (const oldKey of removed) {
    const match = added.find(
      (a) => !consumedAdds.has(a) && deepEqual(oldValue[oldKey], newValue[a])
    );
    if (match) {
      renames.set(oldKey, match);
      consumedAdds.add(match);
    }
  }

  const structural =
    removed.some((k) => !renames.has(k)) || added.some((k) => !consumedAdds.has(k));
  if (map.flow && structural) {
    throw new SurgicalFallback("structural change inside a flow collection");
  }

  // 1. Renames — replace just the key token.
  for (const [oldKey, newKey] of renames) {
    const pair = findPair(oldKey);
    const range = (pair?.key as { range?: [number, number, number] } | undefined)?.range;
    if (!range) throw new SurgicalFallback("rename: missing key range");
    edits.push({ start: range[0], end: range[1], text: serializeInline(newKey) });
  }

  // 2. Deletes — remove the key's own line(s), but never the next sibling's
  //    leading comment.
  for (const key of removed) {
    if (renames.has(key)) continue;
    const pair = findPair(key);
    const keyRange = (pair?.key as { range?: [number, number, number] } | undefined)?.range;
    if (!pair || !keyRange) throw new SurgicalFallback("delete: missing pair");
    const lineStart = lineStartOf(src, keyRange[0]);
    const end = endOfPairLine(src, pair);
    edits.push({ start: lineStart, end, text: "" });
  }

  // 3. Additions — append after the last existing item, matching its indent.
  const realAdds = added.filter((k) => !consumedAdds.has(k));
  if (realAdds.length > 0) {
    if (map.items.length === 0) {
      throw new SurgicalFallback("add into an empty map");
    }
    const firstKeyRange = (map.items[0].key as { range: [number, number, number] }).range;
    const indent = src.slice(lineStartOf(src, firstKeyRange[0]), firstKeyRange[0]);

    const last = map.items[map.items.length - 1];
    const insertAt = endOfPairLine(src, last);
    // A missing newline only happens at EOF; add one so the new block starts
    // on its own line.
    const prefix = src[insertAt - 1] === "\n" ? "" : "\n";

    const addObj: Record<string, unknown> = {};
    for (const key of newKeys) {
      if (realAdds.includes(key)) addObj[key] = newValue[key];
    }

    edits.push({
      start: insertAt,
      end: insertAt,
      text: `${prefix}${serializeBlock(addObj, indent)}\n`,
    });
  }

  // 4. Kept keys — recurse into objects or replace changed scalar/array values.
  for (const key of newKeys) {
    if (!oldSet.has(key)) continue; // additions handled above
    const oldChild = oldValue[key];
    const newChild = newValue[key];
    if (deepEqual(oldChild, newChild)) continue;

    const pair = findPair(key);
    if (!pair) throw new SurgicalFallback("change: missing pair");

    if (isPlainObject(oldChild) && isPlainObject(newChild)) {
      diffMap(pair.value, src, edits, oldChild, newChild);
    } else if (!isPlainObject(oldChild) && !isPlainObject(newChild)) {
      const range = (pair.value as { range?: [number, number, number] } | null)?.range;
      if (!range) throw new SurgicalFallback("change: missing value range");
      edits.push({ start: range[0], end: range[1], text: serializeInline(newChild) });
    } else {
      // scalar <-> object reshaping is not safely expressible as a splice.
      throw new SurgicalFallback("change: value reshaped");
    }
  }
}

// Document-rewrite fallback (the original strategy): correct data, but may
// reflow comment alignment. Used only for edits the surgical patcher declines.
function applyViaDocument(currentText: string, newTree: Record<string, unknown>): string {
  const doc = parseDocument(currentText);
  const oldValue = (doc.toJS() ?? {}) as Record<string, unknown>;

  const walk = (
    oldValueInner: unknown,
    newValueInner: unknown,
    path: Array<string | number>
  ) => {
    const innerOldKeys = isPlainObject(oldValueInner) ? Object.keys(oldValueInner) : [];
    const innerNewKeys = isPlainObject(newValueInner) ? Object.keys(newValueInner) : [];

    for (const key of innerOldKeys) {
      if (!innerNewKeys.includes(key)) doc.deleteIn([...path, key]);
    }

    for (const key of innerNewKeys) {
      const nextPath = [...path, key];
      const oldChild = isPlainObject(oldValueInner)
        ? (oldValueInner as Record<string, unknown>)[key]
        : undefined;
      const newChild = (newValueInner as Record<string, unknown>)[key];

      if (!innerOldKeys.includes(key)) {
        doc.setIn(nextPath, newChild);
      } else if (isPlainObject(oldChild) && isPlainObject(newChild)) {
        walk(oldChild, newChild, nextPath);
      } else if (!deepEqual(oldChild, newChild)) {
        doc.setIn(nextPath, newChild);
      }
    }
  };

  walk(oldValue, newTree, []);
  return doc.toString();
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
    throw codedError("Invalid pricing payload: root must be an object", 400);
  }

  if (Object.keys(newTree).length === 0) {
    throw codedError("Refusing to write an empty pricing config", 422);
  }

  assertNoUnsafeKeys(newTree);
  assertNoAnchors(doc);

  const currentObj = (doc.toJS() ?? {}) as Record<string, unknown>;

  let out: string;
  try {
    const edits: Splice[] = [];
    diffMap(doc.contents, currentText, edits, currentObj, newTree);

    if (edits.length === 0) {
      out = currentText; // nothing changed
    } else {
      // Apply right-to-left so earlier offsets stay valid; reject overlaps.
      edits.sort((a, b) => b.start - a.start);
      out = currentText;
      let lastStart = Number.POSITIVE_INFINITY;
      for (const edit of edits) {
        if (edit.end > lastStart) throw new SurgicalFallback("overlapping edits");
        out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
        lastStart = edit.start;
      }
    }

    const verify = parseDocument(out);
    if (verify.errors.length > 0) throw new SurgicalFallback("surgical output invalid");
    if (!deepEqual(verify.toJS() ?? {}, newTree)) {
      throw new SurgicalFallback("surgical output does not match requested tree");
    }
  } catch (caught) {
    if (!(caught instanceof SurgicalFallback)) throw caught;
    out = applyViaDocument(currentText, newTree);
  }

  // Sanity check: the serialized result must round-trip as valid YAML and match
  // the requested tree exactly, whichever path produced it.
  const verify = parseDocument(out);
  if (verify.errors.length > 0) {
    throw codedError("Internal error: serialized pricing.yml is invalid", 500);
  }
  if (!deepEqual(verify.toJS() ?? {}, newTree)) {
    throw codedError("Internal error: serialized pricing.yml lost data", 500);
  }

  return out;
}

export type PricingFile = {
  path: string;
  raw: string;
  tree: unknown;
  hash: string;
  formats: NumberFormats;
  // A file we can read but not safely write back (anchors/aliases/merge keys).
  readOnly: boolean;
  readOnlyReason: string | null;
};

export async function readPricing(): Promise<PricingFile> {
  const { stdout } = await runSsh(`cat '${cfg.file}'`);
  const raw = stdout;

  if (!raw.trim()) {
    throw codedError("pricing.yml is empty or could not be read", 422);
  }

  const doc = parseDocument(raw);

  if (doc.errors.length > 0) {
    throw codedError(
      `pricing.yml is not valid YAML: ${doc.errors[0].message}`,
      422
    );
  }

  const formats: NumberFormats = {};
  collectNumberFormats(doc.contents, [], formats);

  // Flag anchors/aliases/merge keys up front so the UI can show a read-only
  // banner immediately on load, not only after a failed save (issue #6).
  const anchorProblem = detectAnchors(doc);

  return {
    path: cfg.file,
    raw,
    tree: doc.toJS() ?? {},
    hash: sha256(raw),
    formats,
    readOnly: anchorProblem != null,
    readOnlyReason: anchorProblem
      ? `Файл використовує YAML ${anchorProblem}; редактор не може зберегти його без втрат. Редагуйте файл вручну.`
      : null,
  };
}

// Build the remote shell script that atomically replaces the pricing file.
// Exported so tests can run it against a local temp dir (no SSH) and assert the
// real cp/chmod/mv/backup/prune behaviour, including failure modes (issues #7,#8).
//
// Order is chosen so no step can leave a half-written file in place:
//   1. stream the new content into a sibling temp file;
//   2. verify its byte length matches what we sent (catch a truncated stream);
//   3. copy the original's permissions onto the temp file (mandatory);
//   4. take the mandatory rolling `.bak` (abort if it fails — issue #8);
//   5. take a best-effort timestamped backup, pruned to the 10 newest (issue #7);
//   6. atomically rename the temp file over the original.
// `set -e` aborts the whole script if any mandatory step fails; an EXIT trap
// removes the temp file so a failure leaves no debris and never reports success
// after a partial write. The timestamp carries `$$` so two saves in the same
// second still get distinct history names.
export function buildWriteScript(opts: { file: string; bytes: number }): string {
  const f = opts.file.replace(/'/g, `'\\''`);
  const bytes = String(opts.bytes);
  return [
    "set -e",
    `f='${f}'`,
    'tmp="$f.tmp.$$"',
    `trap 'rm -f "$tmp"' EXIT`,
    'cat > "$tmp"',
    `actual=$(wc -c < "$tmp" | tr -d '[:space:]')`,
    `if [ "$actual" != '${bytes}' ]; then echo "pricing.yml stream incomplete ($actual/${bytes} bytes)" >&2; exit 3; fi`,
    'chmod --reference="$f" "$tmp"',
    'cp -p "$f" "$f.bak"',
    'ts=$(date +%Y%m%d-%H%M%S)-$$',
    'cp -p "$f" "$f.bak.$ts" 2>/dev/null || true',
    `ls -1t "$f".bak.* 2>/dev/null | tail -n +11 | xargs -r rm -f -- 2>/dev/null || true`,
    'mv -f "$tmp" "$f"',
  ].join("\n");
}

export async function writePricing(
  newTree: unknown,
  baseHash?: string
): Promise<PricingFile & { ok: true }> {
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
    const script = buildWriteScript({
      file: cfg.file,
      bytes: Buffer.byteLength(newText, "utf8"),
    });

    await runSshWithInput(script, newText, 20000);
  }

  const verify = parseDocument(newText);
  const formats: NumberFormats = {};
  collectNumberFormats(verify.contents, [], formats);

  return {
    ok: true,
    path: cfg.file,
    raw: newText,
    tree: verify.toJS() ?? {},
    hash: sha256(newText),
    formats,
    readOnly: false,
    readOnlyReason: null,
  };
}
