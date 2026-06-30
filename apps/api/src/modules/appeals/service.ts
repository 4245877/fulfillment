// Appeals service — dispatches each operation to the shop service at
// 192.168.0.139 when APPEALS_SERVICE_URL is configured, otherwise to the local
// in-memory store. The route layer never needs to know which is active.
//
// Upstream responses are normalised to the dashboard's expected shapes:
//   list        → Appeal[]
//   get/read    → Appeal
//   sendMessage → { message, item: Appeal }
//   setStatus   → Appeal
// so the shop service may answer with either `{ item }` / `{ items }` wrappers
// or bare objects/arrays.

import type { Appeal, AppealStatus } from "./types";
import { localStore } from "./store";
import { isUpstreamEnabled, upstream } from "./upstream";

const unwrapItem = (res: any): Appeal => (res && res.item ? res.item : res);

const unwrapItems = (res: any): Appeal[] =>
  Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : [];

export async function listAppeals(): Promise<Appeal[]> {
  if (isUpstreamEnabled()) return unwrapItems(await upstream.list());
  return localStore.list();
}

export async function getAppeal(id: string): Promise<Appeal> {
  if (isUpstreamEnabled()) return unwrapItem(await upstream.get(id));
  return localStore.get(id);
}

export async function markAppealRead(id: string): Promise<Appeal> {
  if (isUpstreamEnabled()) return unwrapItem(await upstream.markRead(id));
  return localStore.markRead(id);
}

export async function sendAppealMessage(
  id: string,
  text: string
): Promise<{ message: Appeal["messages"][number]; item: Appeal }> {
  if (isUpstreamEnabled()) {
    const res = await upstream.sendMessage(id, text);
    return { message: res?.message ?? null, item: unwrapItem(res) };
  }
  return localStore.sendMessage(id, text);
}

export async function setAppealStatus(
  id: string,
  status: AppealStatus
): Promise<Appeal> {
  if (isUpstreamEnabled()) return unwrapItem(await upstream.setStatus(id, status));
  return localStore.setStatus(id, status);
}
