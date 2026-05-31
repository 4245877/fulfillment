export type ProductReportStatus = "new" | "in_review" | "resolved" | "rejected";

export type ProductReport = {
  report_id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  reason: string;
  comment: string | null;
  page_url: string | null;
  status: ProductReportStatus;
  created_at: string;
  resolved_at: string | null;
  admin_note: string | null;

  // Антиспам / источник
  source: "shop";
  client_ip_hash: string;
  user_agent: string | null;
  referer: string | null;
};

export type ProductReportsStore = {
  version: 1;
  reports: ProductReport[];
};

export type CreateProductReportInput = {
  product_id?: string;
  product_name?: string;
  product_sku?: string;
  reason?: string;
  comment?: string;
  page_url?: string;
};

export type CreateProductReportMeta = {
  ip?: string;
  user_agent?: string;
  referer?: string;
};

export type ListProductReportsInput = {
  status?: ProductReportStatus | "";
  q?: string;
  limit?: number;
};

export type UpdateProductReportInput = {
  status?: ProductReportStatus;
  admin_note?: string | null;
};