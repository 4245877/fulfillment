import { promises as fs } from "node:fs";
import path from "node:path";

import type { ProductReportsStore } from "./types";

const DATA_FILE =
  process.env.PRODUCT_REPORTS_DATA_FILE ||
  path.join(process.cwd(), "data", "product-reports.json");

function createEmptyStore(): ProductReportsStore {
  return {
    version: 1,
    reports: [],
  };
}

function normalizeStore(value: unknown): ProductReportsStore {
  const fallback = createEmptyStore();

  if (!value || typeof value !== "object") {
    return fallback;
  }

  const raw = value as Partial<ProductReportsStore>;

  return {
    version: 1,
    reports: Array.isArray(raw.reports) ? raw.reports : [],
  };
}

export async function readProductReportsStore(): Promise<ProductReportsStore> {
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

export async function writeProductReportsStore(
  store: ProductReportsStore
): Promise<void> {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });

  const tmpFile = `${DATA_FILE}.tmp`;

  await fs.writeFile(tmpFile, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmpFile, DATA_FILE);
}

export async function updateProductReportsStore<T>(
  mutator: (store: ProductReportsStore) => T | Promise<T>
): Promise<T> {
  const store = await readProductReportsStore();
  const result = await mutator(store);

  await writeProductReportsStore(store);

  return result;
}