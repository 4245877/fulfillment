import { createHmac, randomUUID } from "node:crypto";

import {
  readProductReportsStore,
  updateProductReportsStore,
} from "./repo";

import type {
  CreateProductReportInput,
  CreateProductReportMeta,
  ListProductReportsInput,
  ProductReport,
  ProductReportStatus,
  UpdateProductReportInput,
} from "./types";

const REPORT_STATUSES: ProductReportStatus[] = [
  "new",
  "in_review",
  "resolved",
  "rejected",
];

const MAX_REASON_LENGTH = 200;
const MAX_COMMENT_LENGTH = 1000;
const MAX_ADMIN_NOTE_LENGTH = 5000;
const MAX_PAGE_URL_LENGTH = 2000;

const ONE_HOUR_MS = 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

const MAX_REPORTS_PER_IP_PER_HOUR = 6;
const MAX_REPORTS_PER_PRODUCT_IP_PER_HOUR = 2;
const MAX_REPORTS_IN_STORE = 10000;

const rateHits = new Map<string, number[]>();

export class ProductReportError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

function cleanString(value: unknown, maxLength: number): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function cleanNullableString(value: unknown, maxLength: number): string | null {
  const clean = cleanString(value, maxLength);
  return clean ? clean : null;
}

function normalizeStatus(value: unknown): ProductReportStatus {
  const status = String(value || "").trim() as ProductReportStatus;

  if (!REPORT_STATUSES.includes(status)) {
    throw new ProductReportError("Invalid report status", 400);
  }

  return status;
}

function normalizeProductId(productId: unknown, input?: CreateProductReportInput) {
  const fromPath = cleanString(productId, 200);
  const fromBody = cleanString(input?.product_id, 200);

  const result = fromPath || fromBody;

  if (!result) {
    throw new ProductReportError("product_id is required", 400);
  }

  return result;
}

function normalizeReason(value: unknown) {
  const reason = cleanString(value, MAX_REASON_LENGTH);

  if (!reason) {
    throw new ProductReportError("reason is required", 400);
  }

  const key = reason.toLowerCase();

  const aliases: Record<string, string> = {
    "некоректний опис": "Некоректний опис",
    "некорректний опис": "Некоректний опис",
    "некорректное описание": "Некоректний опис",
    "некоректное описание": "Некоректний опис",

    "неправильні характеристики": "Неправильні характеристики",
    "неправильные характеристики": "Неправильні характеристики",
    "невірні характеристики": "Неправильні характеристики",
    "неверные характеристики": "Неправильні характеристики",

    "підозра на підробку": "Підозра на підробку",
    "подозрение на подделку": "Підозра на підробку",

    "заборонений товар": "Заборонений товар",
    "запрещенный товар": "Заборонений товар",
    "запрещённый товар": "Заборонений товар",

    "інше": "Інше",
    "інша причина": "Інше",
    "другое": "Інше",
    "другая причина": "Інше",
  };

  return aliases[key] || reason;
}

function getTime(value: string | null | undefined) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
}

function hashIp(ip: string) {
  const secret =
    process.env.REPORTS_HASH_SECRET ||
    process.env.ADMIN_TOKEN ||
    "local-product-reports-secret";

  return createHmac("sha256", secret)
    .update(ip || "unknown")
    .digest("hex");
}

function cleanupHits(items: number[], windowMs: number) {
  const min = Date.now() - windowMs;
  return items.filter((time) => time >= min);
}

function assertMemoryRateLimit(
  key: string,
  windowMs: number,
  maxHits: number,
  message: string,
) {
  const current = cleanupHits(rateHits.get(key) || [], windowMs);

  if (current.length >= maxHits) {
    rateHits.set(key, current);
    throw new ProductReportError(message, 429);
  }

  current.push(Date.now());
  rateHits.set(key, current);
}

function looksLikeSpam(reason: string, comment: string | null) {
  const text = [reason, comment].filter(Boolean).join(" ");

  const urlMatches = text.match(/https?:\/\/|www\./gi) || [];
  if (urlMatches.length >= 3) return true;

  if (/(.)\1{20,}/.test(text)) return true;

  const compact = text.replace(/\s+/g, "");
  if (compact.length >= 80 && new Set(compact).size <= 4) return true;

  return false;
}

function countRecentReports(
  reports: ProductReport[],
  predicate: (report: ProductReport) => boolean,
  windowMs: number,
) {
  const min = Date.now() - windowMs;

  return reports.filter((report) => {
    return getTime(report.created_at) >= min && predicate(report);
  }).length;
}

export async function createProductReport(
  productId: string,
  input: CreateProductReportInput = {},
  meta: CreateProductReportMeta = {},
): Promise<ProductReport> {
  const normalizedProductId = normalizeProductId(productId, input);
  const reason = normalizeReason(input.reason);
  const comment = cleanNullableString(input.comment, MAX_COMMENT_LENGTH);
  const productName = cleanString(input.product_name, 300);
  const productSku = cleanString(input.product_sku, 120);
  const pageUrl = cleanNullableString(input.page_url, MAX_PAGE_URL_LENGTH);

  if (looksLikeSpam(reason, comment)) {
    throw new ProductReportError("Report looks like spam", 429);
  }

  const ipHash = hashIp(cleanString(meta.ip, 200));

  assertMemoryRateLimit(
    `ip:${ipHash}`,
    ONE_HOUR_MS,
    MAX_REPORTS_PER_IP_PER_HOUR,
    "Too many reports. Try again later.",
  );

  assertMemoryRateLimit(
    `product:${normalizedProductId}:ip:${ipHash}`,
    ONE_HOUR_MS,
    MAX_REPORTS_PER_PRODUCT_IP_PER_HOUR,
    "Report for this product was already sent recently.",
  );

  const createdAt = nowIso();

  return updateProductReportsStore((store) => {
    const duplicate = store.reports.find((report) => {
      const freshEnough = getTime(report.created_at) >= Date.now() - SIX_HOURS_MS;

      return (
        freshEnough &&
        report.product_id === normalizedProductId &&
        report.client_ip_hash === ipHash &&
        report.reason === reason &&
        (report.comment || "") === (comment || "")
      );
    });

    if (duplicate) {
      return duplicate;
    }

    const reportsByIp = countRecentReports(
      store.reports,
      (report) => report.client_ip_hash === ipHash,
      ONE_HOUR_MS,
    );

    if (reportsByIp >= MAX_REPORTS_PER_IP_PER_HOUR) {
      throw new ProductReportError("Too many reports. Try again later.", 429);
    }

    const reportsByProductIp = countRecentReports(
      store.reports,
      (report) =>
        report.client_ip_hash === ipHash &&
        report.product_id === normalizedProductId,
      ONE_HOUR_MS,
    );

    if (reportsByProductIp >= MAX_REPORTS_PER_PRODUCT_IP_PER_HOUR) {
      throw new ProductReportError(
        "Report for this product was already sent recently.",
        429,
      );
    }

    const report: ProductReport = {
      report_id: id("product_report"),
      product_id: normalizedProductId,
      product_name: productName,
      product_sku: productSku,
      reason,
      comment,
      page_url: pageUrl,
      status: "new",
      created_at: createdAt,
      resolved_at: null,
      admin_note: null,

      source: "shop",
      client_ip_hash: ipHash,
      user_agent: cleanNullableString(meta.user_agent, 500),
      referer: cleanNullableString(meta.referer, 1000),
    };

    store.reports.unshift(report);

    if (store.reports.length > MAX_REPORTS_IN_STORE) {
      store.reports = store.reports.slice(0, MAX_REPORTS_IN_STORE);
    }

    return report;
  });
}

export async function listProductReports(input: ListProductReportsInput = {}) {
  const store = await readProductReportsStore();

  const status = input.status ? normalizeStatus(input.status) : "";
  const q = String(input.q || "").trim().toLowerCase();

  const limit = Math.max(
    1,
    Math.min(Number.isFinite(input.limit) ? Number(input.limit) : 100, 500),
  );

  let reports = [...store.reports];

  if (status) {
    reports = reports.filter((report) => report.status === status);
  }

  if (q) {
    reports = reports.filter((report) => {
      const haystack = [
        report.report_id,
        report.product_id,
        report.product_name,
        report.product_sku,
        report.reason,
        report.comment,
        report.page_url,
        report.status,
        report.admin_note,
        report.source,
        report.user_agent,
        report.referer,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }

  reports.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return {
    items: reports.slice(0, limit),
    total: reports.length,
    statuses: REPORT_STATUSES,
  };
}

export async function updateProductReport(
  reportId: string,
  input: UpdateProductReportInput,
): Promise<ProductReport> {
  const cleanReportId = cleanString(reportId, 200);

  if (!cleanReportId) {
    throw new ProductReportError("report_id is required", 400);
  }

  return updateProductReportsStore((store) => {
    const report = store.reports.find((item) => item.report_id === cleanReportId);

    if (!report) {
      throw new ProductReportError("Product report not found", 404);
    }

    if (input.status !== undefined) {
      const nextStatus = normalizeStatus(input.status);

      report.status = nextStatus;

      if (nextStatus === "resolved" || nextStatus === "rejected") {
        report.resolved_at = report.resolved_at || nowIso();
      } else {
        report.resolved_at = null;
      }
    }

    if (input.admin_note !== undefined) {
      report.admin_note = cleanNullableString(
        input.admin_note,
        MAX_ADMIN_NOTE_LENGTH,
      );
    }

    return report;
  });
}