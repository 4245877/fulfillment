// Pure, framework-free helpers for the pricing editor. Kept out of the React
// component so they can be unit-tested with the Node test runner (no DOM, no
// build step). PricingSection.jsx imports everything from here.

// ---------------------------------------------------------------------------
// Prototype-pollution-safe object helpers (issue #10).
//
// Keys named "__proto__" / "prototype" / "constructor" must never reach the
// prototype chain. We block them in the UI, and the tree-mutation helpers below
// also write through Object.defineProperty so that even a key literally named
// "__proto__" becomes an own data property instead of mutating a prototype.
// ---------------------------------------------------------------------------
export const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function isUnsafeKey(key) {
  return UNSAFE_KEYS.has(key);
}

export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneContainer(value) {
  return Array.isArray(value) ? value.slice() : { ...value };
}

// Assign without writing through the prototype chain.
export function assignKey(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return target;
}

// Immutable set at an array path. Safe for keys that contain dots (e.g.
// options.nozzle_mm."0.2") and for unsafe key names.
export function setAt(obj, path, value) {
  if (path.length === 0) return value;

  const [head, ...rest] = path;
  const copy = cloneContainer(obj);

  return assignKey(
    copy,
    head,
    rest.length === 0 ? value : setAt(obj[head], rest, value)
  );
}

export function deleteAt(obj, path) {
  const [head, ...rest] = path;
  const copy = cloneContainer(obj);

  if (rest.length === 0) {
    delete copy[head];
  } else {
    copy[head] = deleteAt(obj[head], rest);
  }

  return copy;
}

export function getAt(obj, path) {
  let current = obj;
  for (const key of path) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

// Rename a key while keeping its position in the parent object (so the YAML
// backend can recognise it as an in-place rename and preserve comments).
// Rebuilds via assignKey so an unsafe target key can never pollute a prototype
// or silently drop the value (issue #10).
export function renameKeyAt(obj, path, newKey) {
  const parentPath = path.slice(0, -1);
  const oldKey = path[path.length - 1];
  const parent = getAt(obj, parentPath);

  if (!isPlainObject(parent)) return obj;

  const rebuilt = {};
  for (const key of Object.keys(parent)) {
    assignKey(rebuilt, key === oldKey ? newKey : key, parent[key]);
  }

  return setAt(obj, parentPath, rebuilt);
}

// ---------------------------------------------------------------------------
// Number parsing / display (issues #1 / #4).
// ---------------------------------------------------------------------------
export function numToStr(value) {
  return Number.isFinite(value) ? String(value) : "";
}

// Accept decimal notation only — optionally signed, optional fraction, optional
// exponent — and additionally accept the UA/RU decimal comma "6,5".
//
// Rejects: "" / whitespace, hex/binary/octal (Number("0x10") === 16!),
// thousands separators, and any non-finite result (Number("1e309") === Infinity,
// Number("Infinity")). This makes the editor's behaviour predictable instead of
// inheriting all of Number()'s quirks.
const DECIMAL_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function parseNumberInput(text) {
  const normalized = String(text).trim().replace(",", ".");
  if (!DECIMAL_RE.test(normalized)) return { ok: false };

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false };
}

// Show numbers exactly as they appear in the file (e.g. "6.00", "40.0") instead
// of the lossy JS form ("6", "40"). `format` is the original source text from the
// backend; we only trust it while it still represents the current value, so an
// edited field falls back to the plain numeric string (issue #1).
export function resolveNumberDisplay(value, format) {
  if (typeof format === "string") {
    const parsed = parseNumberInput(format);
    if (parsed.ok && parsed.value === value) return format;
  }
  return numToStr(value);
}

// Carry the trailing-zero formatting hints across an in-place rename so "6.00"
// keeps displaying as "6.00" without waiting for the next server reload
// (issue #3). Format keys are JSON-encoded segment arrays; we rewrite the renamed
// segment for the renamed node and every descendant.
export function remapFormatsForRename(formats, path, newKey) {
  const idx = path.length - 1;
  const out = {};

  for (const [key, value] of Object.entries(formats)) {
    let segments;
    try {
      segments = JSON.parse(key);
    } catch {
      out[key] = value;
      continue;
    }

    const matches =
      Array.isArray(segments) &&
      segments.length > idx &&
      path.every((segment, i) => segments[i] === segment);

    if (matches) {
      const next = segments.slice();
      next[idx] = newKey;
      out[JSON.stringify(next)] = value;
    } else {
      out[key] = value;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Validation: known enums + value ranges (issue #2 client side).
// ---------------------------------------------------------------------------
export const ENUM_OPTIONS = {
  mode: ["markup", "margin"],
  missing_material_price: ["error", "zero", "fallback"],
  strategy: ["nearest_9", "nearest", "none"],
};

// Returns the option list for a known enum key, always including the current
// value so a valid value the schema didn't anticipate is never dropped.
export function enumOptionsFor(key, value) {
  const known = ENUM_OPTIONS[key];
  if (!known) return null;
  if (typeof value !== "string") return null;
  return known.includes(value) ? known : [value, ...known];
}

export function isFractionKey(key) {
  return key === "yield" || /_pct$/.test(key);
}

export function isNonNegativeKey(key) {
  return /(price|rate|cost|fee)/i.test(key);
}

export function validateScalar(key, value) {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return "Ожидается число";
  if (isFractionKey(key) && (value < 0 || value > 1)) {
    return "Должно быть долей от 0 до 1";
  }
  if (isNonNegativeKey(key) && value < 0) {
    return "Не может быть отрицательным";
  }
  return null;
}

export function collectErrors(node, path, out) {
  if (Array.isArray(node)) return;
  if (isPlainObject(node)) {
    for (const key of Object.keys(node)) {
      collectErrors(node[key], [...path, key], out);
    }
    return;
  }
  const key = path[path.length - 1];
  const message = validateScalar(key, node);
  if (message) out[JSON.stringify(path)] = message;
}

// ---------------------------------------------------------------------------
// "Add new value" model.
// ---------------------------------------------------------------------------
export const TYPE_OPTIONS = [
  { value: "string", label: "Текст" },
  { value: "number", label: "Число" },
  { value: "boolean", label: "Да / Нет" },
  { value: "group", label: "Группа" },
  { value: "array", label: "Массив" },
];

export function initialValueForType(type, rawValue) {
  if (type === "number") {
    const parsed = parseNumberInput(rawValue);
    return parsed.ok ? parsed.value : 0;
  }

  if (type === "boolean") return rawValue === "true" || rawValue === true;
  if (type === "group") return {};
  if (type === "array") return [];

  return rawValue ?? "";
}
