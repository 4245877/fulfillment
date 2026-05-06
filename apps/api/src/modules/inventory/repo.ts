import { promises as fs } from "node:fs";
import path from "node:path";

import type { InventoryStore } from "./types";

const DATA_FILE =
  process.env.INVENTORY_DATA_FILE ||
  path.join(process.cwd(), "data", "inventory.json");

function createEmptyStore(): InventoryStore {
  return {
    version: 1,
    filamentStock: [],
    filamentMovements: [],
    printerFilamentState: [],
  };
}

function normalizeStore(value: unknown): InventoryStore {
  const fallback = createEmptyStore();

  if (!value || typeof value !== "object") {
    return fallback;
  }

  const raw = value as Partial<InventoryStore>;

  return {
    version: 1,
    filamentStock: Array.isArray(raw.filamentStock) ? raw.filamentStock : [],
    filamentMovements: Array.isArray(raw.filamentMovements)
      ? raw.filamentMovements
      : [],
    printerFilamentState: Array.isArray(raw.printerFilamentState)
      ? raw.printerFilamentState
      : [],
  };
}

export async function readInventoryStore(): Promise<InventoryStore> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;

    if (code === "ENOENT") {
      return createEmptyStore();
    }

    throw error;
  }
}

export async function writeInventoryStore(store: InventoryStore): Promise<void> {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });

  const tmpFile = `${DATA_FILE}.tmp`;

  await fs.writeFile(tmpFile, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmpFile, DATA_FILE);
}

export async function updateInventoryStore<T>(
  mutator: (store: InventoryStore) => T | Promise<T>
): Promise<T> {
  const store = await readInventoryStore();
  const result = await mutator(store);

  await writeInventoryStore(store);

  return result;
}