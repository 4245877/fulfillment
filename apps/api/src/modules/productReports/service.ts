import { randomUUID } from "node:crypto";

import {
  readProductReportsStore,
  updateProductReportsStore,
} from "./repo";

import type {
  CreateProductReportInput,
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
const MAX_COMMENT_LENGTH = 5000;
const MAX_ADMIN_NOTE_LENGTH = 5000;
const MAX_PAGE_URL_LENGTH = 2000;

function nowIso() {
  return new Date().toISOString();
}

function id(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

function cleanString(value: unknown, maxLength: number): string {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function cleanNullableString(value: unknown, maxLength: number): string | null {
  const clean = cleanString(value, maxLength);
  return clean ? clean : null;
}

function normalizeStatus(value: unknown): ProductReportStatus {
  const status = String(value || "").trim() as ProductReportStatus;

  if (!REPORT_STATUSES.includes(status)) {
    throw new Error("Invalid report status");
  }

  return status;
}

function normalizeProductId(productId: unknown, input?: CreateProductReportInput) {
  const fromPath = cleanString(productId, 200);
  const fromBody = cleanString(input?.product_id, 200);

  const result = fromPath || fromBody;

  if (!result) {
    throw new Error("product_id is required");
  }

  return result;
}

function normalizeReason(value: unknown) {
  const reason = cleanString(value, MAX_REASON_LENGTH);

  if (!reason) {
    throw new Error("reason is required");
  }

  return reason;
}

export async function createProductReport(
  productId: string,
  input: CreateProductReportInput
): Promise<ProductReport> {
  const createdAt = nowIso();

  const report: ProductReport = {
    report_id: id("product_report"),
    product_id: normalizeProductId(productId, input),
    product_name: cleanString(input.product_name, 300),
    product_sku: cleanString(input.product_sku, 120),
    reason: normalizeReason(input.reason),
    comment: cleanNullableString(input.comment, MAX_COMMENT_LENGTH),
    page_url: cleanNullableString(input.page_url, MAX_PAGE_URL_LENGTH),
    status: "new",
    created_at: createdAt,
    resolved_at: null,
    admin_note: null,
  };

  return updateProductReportsStore((store) => {
    store.reports.unshift(report);
    return report;
  });
}

export async function listProductReports(input: ListProductReportsInput = {}) {
  const store = await readProductReportsStore();

  const status = input.status ? normalizeStatus(input.status) : "";
  const q = String(input.q || "").trim().toLowerCase();

  const limit = Math.max(
    1,
    Math.min(Number.isFinite(input.limit) ? Number(input.limit) : 100, 500)
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
  input: UpdateProductReportInput
): Promise<ProductReport> {
  const cleanReportId = cleanString(reportId, 200);

  if (!cleanReportId) {
    throw new Error("report_id is required");
  }

  return updateProductReportsStore((store) => {
    const report = store.reports.find((item) => item.report_id === cleanReportId);

    if (!report) {
      throw new Error("Product report not found");
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
        MAX_ADMIN_NOTE_LENGTH
      );
    }

    return report;
  });
}