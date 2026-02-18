// apps/dashboard/src/pages/settings/utils.js
export function safeParseJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function mergeDefaults(defaults, incoming) {
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

export function cloneDeep(obj) {
  if (typeof structuredClone === "function") return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

// Клонувати лише вздовж шляху (дешево для великих конфігів)
export function setByPath(obj, path, value) {
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
