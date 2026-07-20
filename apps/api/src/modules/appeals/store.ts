// In-memory appeals store — DEV/DEMO ONLY seed data.
//
// This is NOT a fallback for the real service: it is served only when
// APPEALS_USE_MOCK is explicitly enabled and no APPEALS_SERVICE_URL is set (see
// ./service.ts). In every other case the page reports the service as
// unavailable instead of showing these demo chats as if they were real.
//
// Use it to work on the dashboard "Обращения" UI offline. The data lives in
// process memory: it is seeded on boot, mutates as the operator works, and
// resets on restart.

import type { Appeal, AppealStatus } from "./types";
import type { AppealIngestInput } from "./persistentStore";

const str = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);
const randomId = () => `apl-${Math.random().toString(36).slice(2, 10)}`;

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();
const hoursAgo = (h: number) => minutesAgo(h * 60);
const daysAgo = (d: number) => minutesAgo(d * 60 * 24);

let messageSeq = 1000;
const nextMessageId = () => `msg-${++messageSeq}`;

const store: Appeal[] = [
  {
    id: "apl-1042",
    status: "new",
    unread: 1,
    createdAt: minutesAgo(3),
    lastMessageAt: minutesAgo(3),
    customer: { name: "Елена Ковальчук", contact: "+380 67 123 45 67" },
    product: {
      id: "NL-MOON-15",
      name: "Ночник «Луна» 15 см",
      sku: "NL-MOON-15",
      url: "/product/nl-moon-15",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Добрый день! Возможно ли изготовить ночник «Луна» диаметром 20 см вместо 15? И будет ли свет тёплым?",
        at: minutesAgo(3),
      },
    ],
  },
  {
    id: "apl-1041",
    status: "new",
    unread: 1,
    createdAt: minutesAgo(15),
    lastMessageAt: minutesAgo(15),
    customer: { name: "Назар Кравец", contact: "+380 63 222 11 00" },
    product: {
      id: "NL-DRAGON",
      name: "Геометрический ночник «Дракон»",
      sku: "NL-DRAGON",
      url: "/product/nl-dragon",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Здравствуйте! Светится равномерно или заметны слои печати?",
        at: minutesAgo(15),
      },
    ],
  },
  {
    id: "apl-1039",
    status: "in_progress",
    unread: 0,
    createdAt: hoursAgo(2),
    lastMessageAt: minutesAgo(25),
    customer: { name: "Андрей Мельник", contact: "@andriy_m" },
    product: {
      id: "HS-WAVE",
      name: "Подставка для наушников «Волна»",
      sku: "HS-WAVE",
      url: "/product/hs-wave",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Здравствуйте! Какой вес выдерживает подставка? У меня массивные студийные наушники.",
        at: hoursAgo(2),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Добрый день, Андрей! Подставка спокойно держит до 1.5 кг — даже большие студийные наушники не проблема 🙂",
        at: minutesAgo(115),
      },
      {
        id: nextMessageId(),
        author: "customer",
        text: "Отлично, спасибо! А какие цвета есть в наличии?",
        at: minutesAgo(28),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Есть графит, мятный, пудровый и белый. Могу скинуть фото образцов, если удобно.",
        at: minutesAgo(25),
      },
    ],
  },
  {
    id: "apl-1036",
    status: "new",
    unread: 2,
    createdAt: hoursAgo(1),
    lastMessageAt: hoursAgo(1),
    customer: { name: "", contact: "@kvitka" },
    product: {
      id: "PLNT-GEO",
      name: "Кашпо для суккулентов «Гео»",
      sku: "PLNT-GEO",
      url: "/product/plnt-geo",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Сколько стоит доставка по Украине?",
        at: minutesAgo(65),
      },
      {
        id: nextMessageId(),
        author: "customer",
        text: "И есть ли самовывоз во Львове?",
        at: hoursAgo(1),
      },
    ],
  },
  {
    id: "apl-1031",
    status: "in_progress",
    unread: 1,
    createdAt: daysAgo(1),
    lastMessageAt: hoursAgo(4),
    customer: { name: "София Бондаренко", contact: "sofia.b@gmail.com" },
    product: {
      id: "VS-SPIRAL-25",
      name: "Ваза «Спираль» 25 см",
      sku: "VS-SPIRAL-25",
      url: "/product/vs-spiral-25",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Заказала вазу, подскажите, когда будет готова?",
        at: daysAgo(1),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Добрый день, София! Уже печатаем, отправим завтра Новой почтой ✨",
        at: minutesAgo(60 * 23),
      },
      {
        id: nextMessageId(),
        author: "customer",
        text: "Спасибо! А можно добавить открытку к заказу?",
        at: hoursAgo(4),
      },
    ],
  },
  {
    id: "apl-1020",
    status: "closed",
    unread: 0,
    createdAt: daysAgo(2),
    lastMessageAt: daysAgo(2),
    customer: { name: "Дмитрий Шевченко", contact: "+380 50 987 65 43" },
    product: {
      id: "PH-CAT",
      name: "Держатель для телефона «Котик»",
      sku: "PH-CAT",
      url: "/product/ph-cat",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Подойдёт ли держатель для iPhone 15 Pro Max в чехле?",
        at: daysAgo(2),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Да, держатель универсальный — подойдёт даже в толстом чехле 👍",
        at: minutesAgo(60 * 24 * 2 - 30),
      },
      {
        id: nextMessageId(),
        author: "customer",
        text: "Супер, спасибо!",
        at: minutesAgo(60 * 24 * 2 - 35),
      },
    ],
  },
  {
    id: "apl-1004",
    status: "closed",
    unread: 0,
    createdAt: daysAgo(5),
    lastMessageAt: daysAgo(5),
    customer: { name: "Мария Ткаченко", contact: "@maria_tk" },
    product: {
      id: "KEY-INIT",
      name: "Брелок с инициалами",
      sku: "KEY-INIT",
      url: "/product/key-init",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Можно брелок с буквами «М» и «Д»?",
        at: daysAgo(5),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Конечно! Сделаем персональный брелок с вашими инициалами. Какой цвет желаете?",
        at: minutesAgo(60 * 24 * 5 - 20),
      },
      {
        id: nextMessageId(),
        author: "customer",
        text: "Розовый 💕 спасибо!",
        at: minutesAgo(60 * 24 * 5 - 40),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Принято, передаю в работу 🌸",
        at: minutesAgo(60 * 24 * 5 - 45),
      },
    ],
  },
];

const clone = <T,>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

const byLatest = (a: Appeal, b: Appeal) =>
  new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();

const find = (id: string) => store.find((thread) => thread.id === id);

export class AppealNotFoundError extends Error {
  statusCode = 404;
  constructor(message = "Обращение не найдено") {
    super(message);
    this.name = "AppealNotFoundError";
  }
}

export const localStore = {
  list(): Appeal[] {
    return clone(store).sort(byLatest);
  },

  get(id: string): Appeal {
    const thread = find(id);
    if (!thread) throw new AppealNotFoundError();
    return clone(thread);
  },

  markRead(id: string): Appeal {
    const thread = find(id);
    if (!thread) throw new AppealNotFoundError();
    thread.unread = 0;
    return clone(thread);
  },

  sendMessage(id: string, text: string): { message: Appeal["messages"][number]; item: Appeal } {
    const thread = find(id);
    if (!thread) throw new AppealNotFoundError();

    const message = {
      id: nextMessageId(),
      author: "operator" as const,
      text: String(text).trim(),
      at: new Date().toISOString(),
    };

    thread.messages.push(message);
    thread.lastMessageAt = message.at;
    // Answering a brand-new appeal moves it into active work automatically.
    if (thread.status === "new") thread.status = "in_progress";

    return { message: clone(message), item: clone(thread) };
  },

  setStatus(id: string, status: AppealStatus): Appeal {
    const thread = find(id);
    if (!thread) throw new AppealNotFoundError();
    thread.status = status;
    return clone(thread);
  },

  // Customer question from the shop (dev/demo mirror of persistentStore.ingest).
  ingest(input: AppealIngestInput): { item: Appeal; message: Appeal["messages"][number]; created: boolean } {
    const at =
      typeof input.at === "string" && input.at.trim() ? input.at : new Date().toISOString();
    const message = {
      id: nextMessageId(),
      author: "customer" as const,
      text: String(input.message ?? "").trim(),
      at,
    };

    const existingId = input.threadId ? String(input.threadId) : "";
    let thread = existingId ? find(existingId) : undefined;
    let created = false;

    if (!thread) {
      thread = {
        id: existingId || randomId(),
        status: "new",
        unread: 0,
        createdAt: at,
        lastMessageAt: at,
        customer: { name: str(input.customer?.name), contact: str(input.customer?.contact) },
        product: {
          id: str(input.product?.id),
          name: str(input.product?.name),
          sku: str(input.product?.sku),
          url: str(input.product?.url),
        },
        messages: [],
      };
      store.push(thread);
      created = true;
    } else if (thread.status === "closed") {
      thread.status = "in_progress";
    }

    thread.messages.push(message);
    thread.lastMessageAt = at;
    thread.unread += 1;

    return { item: clone(thread), message: clone(message), created };
  },
};
