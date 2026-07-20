// Appeals (Обращения) — customer ⇄ operator product-question chat.
//
// A buyer raises a question from the shop's "Задать вопрос мастеру"
// button; the operator answers and works the thread from the dashboard
// "Обращения" page. Text-only messages by design (stage 1 — no attachments).

export type AppealStatus = "new" | "in_progress" | "closed";

export type MessageAuthor = "customer" | "operator";

export interface AppealMessage {
  id: string;
  author: MessageAuthor;
  text: string;
  at: string; // ISO timestamp
}

export interface AppealCustomer {
  name: string;
  contact: string;
}

export interface AppealProduct {
  id: string;
  name: string;
  sku: string;
  url: string;
}

export interface Appeal {
  id: string;
  status: AppealStatus;
  unread: number;
  createdAt: string;
  lastMessageAt: string;
  customer: AppealCustomer;
  product: AppealProduct;
  messages: AppealMessage[];
}

export const APPEAL_STATUSES: AppealStatus[] = ["new", "in_progress", "closed"];

export function isAppealStatus(value: unknown): value is AppealStatus {
  return (
    typeof value === "string" &&
    (APPEAL_STATUSES as string[]).includes(value)
  );
}
