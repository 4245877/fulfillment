export const ORDER_STATUSES = [
  "New",
  "Accepted",
  "PrePrintCheck",
  "Queued",
  "Printing",
  "PostProcess",
  "Packaging",
  "Shipment",
  "Pickup",
  "Delivered",
  "Issued",
  "Cancelled",
  "Problem",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderItemFile = {
  type?: string | null;
  url: string;
  filename?: string | null;
  source?: string | null;
};

export type OrderItem = {
  product_id?: string | number | null;
  variant_id?: string | number | null;
  sku?: string | null;
  name?: string | null;
  qty: number;
  price?: number | null;
  total?: number | null;
  files?: OrderItemFile[];
  [key: string]: unknown;
};

export type OrderRecord = {
  id: string;
  shop_order_id: string | null;
  source: string;
  status: OrderStatus;

  customer_name: string | null;
  email: string | null;
  phone: string | null;

  total_uah: number | null;
  currency: string;

  payment_provider: string | null;
  payment_status: string | null;
  shipping_method: string | null;
  tracking_number: string | null;

  items: OrderItem[];
  shipping_address: unknown | null;
  billing_address: unknown | null;
  source_payload: unknown | null;

  notes: string | null;

  received_at: string;
  created_at: string;
  updated_at: string;
};

export type OrderEventRecord = {
  id: string;
  order_id: string;
  type: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus | null;
  actor: string | null;
  note: string | null;
  payload: unknown | null;
  created_at: string;
};

export type OrderListFilters = {
  status?: string;
  q?: string;
  limit?: number;
};

export type ReceiveOrderInput = {
  id?: string | number;
  order_id?: string | number;
  shop_order_id?: string | number;
  external_id?: string | number;

  source?: string;
  status?: string;

  customer?: {
    name?: string;
    email?: string;
    phone?: string;
  };

  customer_name?: string;
  email?: string;
  phone?: string;

  total?: number;
  total_uah?: number;
  currency?: string;

  payment_provider?: string;
  payment_status?: string;
  shipping_method?: string;
  tracking_number?: string;

  items?: OrderItem[];

  shipping_address?: unknown;
  billing_address?: unknown;

  notes?: string;
  created_at?: string;
};

export type ChangeOrderStatusInput = {
  status: string;
  actor?: string;
  note?: string;
  force?: boolean;
};