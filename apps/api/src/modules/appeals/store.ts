// In-memory appeals store — DEV/DEMO ONLY seed data.
//
// This is NOT a fallback for the real service: it is served only when
// APPEALS_USE_MOCK is explicitly enabled and no APPEALS_SERVICE_URL is set (see
// ./service.ts). In every other case the page reports the service as
// unavailable instead of showing these demo chats as if they were real.
//
// Use it to work on the dashboard "Звернення" UI offline. The data lives in
// process memory: it is seeded on boot, mutates as the operator works, and
// resets on restart.

import type { Appeal, AppealStatus } from "./types";

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
    customer: { name: "Олена Ковальчук", contact: "+380 67 123 45 67" },
    product: {
      id: "NL-MOON-15",
      name: "Нічник «Місяць» 15 см",
      sku: "NL-MOON-15",
      url: "/product/nl-moon-15",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Доброго дня! Чи можливо виготовити нічник «Місяць» діаметром 20 см замість 15? І чи буде світло теплим?",
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
    customer: { name: "Назар Кравець", contact: "+380 63 222 11 00" },
    product: {
      id: "NL-DRAGON",
      name: "Геометричний нічник «Дракон»",
      sku: "NL-DRAGON",
      url: "/product/nl-dragon",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Доброго! Світиться рівномірно чи помітно шари друку?",
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
    customer: { name: "Андрій Мельник", contact: "@andriy_m" },
    product: {
      id: "HS-WAVE",
      name: "Підставка для навушників «Хвиля»",
      sku: "HS-WAVE",
      url: "/product/hs-wave",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Вітаю! Яку вагу витримує підставка? У мене масивні студійні навушники.",
        at: hoursAgo(2),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Доброго дня, Андрію! Підставка спокійно тримає до 1.5 кг — навіть великі студійні навушники не проблема 🙂",
        at: minutesAgo(115),
      },
      {
        id: nextMessageId(),
        author: "customer",
        text: "Чудово, дякую! А які кольори є в наявності?",
        at: minutesAgo(28),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Є графіт, мʼятний, пудровий і білий. Можу скинути фото зразків, якщо зручно.",
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
      name: "Кашпо для сукулентів «Гео»",
      sku: "PLNT-GEO",
      url: "/product/plnt-geo",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Скільки коштує доставка по Україні?",
        at: minutesAgo(65),
      },
      {
        id: nextMessageId(),
        author: "customer",
        text: "І чи є самовивіз у Львові?",
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
    customer: { name: "Софія Бондаренко", contact: "sofia.b@gmail.com" },
    product: {
      id: "VS-SPIRAL-25",
      name: "Ваза «Спіраль» 25 см",
      sku: "VS-SPIRAL-25",
      url: "/product/vs-spiral-25",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Замовила вазу, підкажіть, коли буде готова?",
        at: daysAgo(1),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Доброго дня, Софіє! Вже друкуємо, відправимо завтра Новою поштою ✨",
        at: minutesAgo(60 * 23),
      },
      {
        id: nextMessageId(),
        author: "customer",
        text: "Дякую! А чи можна додати листівку до замовлення?",
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
    customer: { name: "Дмитро Шевченко", contact: "+380 50 987 65 43" },
    product: {
      id: "PH-CAT",
      name: "Тримач для телефону «Котик»",
      sku: "PH-CAT",
      url: "/product/ph-cat",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Чи підійде тримач для iPhone 15 Pro Max у чохлі?",
        at: daysAgo(2),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Так, тримач універсальний — підійде навіть у товстому чохлі 👍",
        at: minutesAgo(60 * 24 * 2 - 30),
      },
      {
        id: nextMessageId(),
        author: "customer",
        text: "Супер, дякую!",
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
    customer: { name: "Марія Ткаченко", contact: "@maria_tk" },
    product: {
      id: "KEY-INIT",
      name: "Брелок з ініціалами",
      sku: "KEY-INIT",
      url: "/product/key-init",
    },
    messages: [
      {
        id: nextMessageId(),
        author: "customer",
        text: "Можна брелок з літерами «М» та «Д»?",
        at: daysAgo(5),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Звичайно! Зробимо персональний брелок із вашими ініціалами. Який колір бажаєте?",
        at: minutesAgo(60 * 24 * 5 - 20),
      },
      {
        id: nextMessageId(),
        author: "customer",
        text: "Рожевий 💕 дякую!",
        at: minutesAgo(60 * 24 * 5 - 40),
      },
      {
        id: nextMessageId(),
        author: "operator",
        text: "Прийнято, передаю в роботу 🌸",
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
  constructor(message = "Звернення не знайдено") {
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
};
