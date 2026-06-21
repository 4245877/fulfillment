import { useEffect, useRef, useState } from "react";
import { DEFAULTS, STORAGE_KEY } from "./defaults.js";
import { safeParseJSON, mergeDefaults, cloneDeep, setByPath } from "./utils.js";

const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || "";

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ADMIN_TOKEN ? { "x-admin-token": ADMIN_TOKEN } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });

  const text = await res.text();

  if (!res.ok) {
    const snippet = text ? `\n\n${text.slice(0, 300)}` : "";
    throw new Error(`${res.status} ${res.statusText} @ ${url}${snippet}`);
  }

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function useSettingsConfig() {
  const [cfg, setCfg] = useState(() => {
    const raw = typeof window !== "undefined"
      ? window.localStorage.getItem(STORAGE_KEY)
      : null;

    const parsed = raw ? safeParseJSON(raw) : null;
    return mergeDefaults(DEFAULTS, parsed || {});
  });

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const saveTimerRef = useRef(null);

  const showToast = (nextToast, ms = 1500) => {
    setToast(nextToast);

    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }

    if (ms != null) {
      toastTimerRef.current = setTimeout(() => {
        setToast(null);
        toastTimerRef.current = null;
      }, ms);
    }
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
      } catch {
        showToast({ kind: "error", text: "Не вдалося зберегти (localStorage)." }, 3000);
      }
    }, 350);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [cfg]);

  const patch = (path, value) => {
    setCfg((cur) => setByPath(cur, path, value));
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(cfg, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fulfillment-settings.json";
    a.click();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const importJson = async (file) => {
    const text = await file.text();
    const parsed = safeParseJSON(text);

    if (!parsed) {
      showToast({ kind: "error", text: "Файл не схожий на JSON." }, 2500);
      return;
    }

    setCfg(mergeDefaults(DEFAULTS, parsed));
    showToast({ kind: "success", text: "Імпортовано ✅" }, 1500);
  };

  const resetAll = () => {
    if (!window.confirm("Скинути всі налаштування до значень за замовчуванням?")) {
      return;
    }

    setCfg(cloneDeep(DEFAULTS));
    showToast({ kind: "success", text: "Скинуто ✅" }, 1200);
  };

  const doAction = async ({ title, description, url, body }) => {
    const ok = window.confirm(`${title}\n\n${description || ""}\n\nПідтвердити?`);
    if (!ok) return null;

    try {
      const result = await postJson(url, body);
      showToast({ kind: "success", text: `${title}: OK` }, 2500);
      return result;
    } catch (e) {
      showToast({ kind: "error", text: `${title}: ${String(e.message || e)}` }, 3500);
      throw e;
    }
  };

  return {
    cfg,
    setCfg,
    patch,
    toast,
    setToast,
    showToast,
    exportJson,
    importJson,
    resetAll,
    doAction,
  };
}

export default useSettingsConfig;