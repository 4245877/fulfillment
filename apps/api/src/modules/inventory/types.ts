export type FilamentMovementType = "add" | "consume" | "adjust";

export type FilamentMovementSource =
  | "dashboard"
  | "telegram"
  | "printer"
  | "system";

export type FilamentStock = {
  id: string;
  material: string;
  color: string;
  colorName: string;
  stockG: number;
  lowStockG: number;
  criticalStockG: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FilamentMovement = {
  id: string;
  stockId: string;
  type: FilamentMovementType;
  quantityG: number;
  beforeG: number;
  afterG: number;
  source: FilamentMovementSource;
  note: string | null;
  printerId: string | null;
  printJobId: string | null;
  idempotencyKey: string | null;
  createdAt: string;
};

export type PrinterFilamentState = {
  id: string;
  printerId: string;
  stockId: string;
  material: string;
  color: string;
  updatedAt: string;
};

export type InventoryStore = {
  version: 1;
  filamentStock: FilamentStock[];
  filamentMovements: FilamentMovement[];
  printerFilamentState: PrinterFilamentState[];
};

export type StockStatus = "ok" | "low" | "critical";

export type FilamentStockView = FilamentStock & {
  stockKg: number;
  status: StockStatus;
};