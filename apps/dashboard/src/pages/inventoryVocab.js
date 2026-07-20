// Single source of truth for the inventory dashboard's small vocabularies, so
// materials / colours / movement types / sources are defined ONCE (no more
// duplicate lists across components). The movement `source` and `type` sets are
// kept in lockstep with the API — apps/api/src/modules/inventory/types.ts
// (FILAMENT_MOVEMENT_SOURCES / FILAMENT_MOVEMENT_TYPES) and the DB CHECK
// constraints. Notably: `telegram` is a real source and IS listed here, while
// the stale `api` value the UI used to show is NOT (the API never emits it).

export const MATERIALS = ["PLA", "PETG", "TPU", "ABS", "ASA"];

export const COLORS = [
  ["black", "Чёрный"],
  ["white", "Белый"],
  ["gray", "Серый"],
  ["red", "Красный"],
  ["blue", "Синий"],
  ["green", "Зелёный"],
  ["yellow", "Жёлтый"],
  ["transparent", "Прозрачный"],
];

// Must match FILAMENT_MOVEMENT_TYPES in the API. (`load_printer_filament` was
// never a real movement type — the DB only stores add/consume/adjust — so it is
// gone.)
export const MOVEMENT_TYPES = [
  ["add", "Добавление"],
  ["consume", "Списание"],
  ["adjust", "Корректировка"],
];

// Must match FILAMENT_MOVEMENT_SOURCES in the API.
export const MOVEMENT_SOURCES = [
  ["dashboard", "Панель управления"],
  ["telegram", "Telegram"],
  ["printer", "Принтер"],
  ["system", "Система"],
];

export function getColorName(color) {
  return COLORS.find(([value]) => value === color)?.[1] || color;
}

export function getMovementTypeLabel(type) {
  return MOVEMENT_TYPES.find(([value]) => value === type)?.[1] || "Неизвестно";
}

export function getMovementSourceLabel(source) {
  return MOVEMENT_SOURCES.find(([value]) => value === source)?.[1] || "Неизвестно";
}
