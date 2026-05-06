import { api } from "./client.js";

export const inventoryApi = {
  stock() {
    return api.get("/api/inventory/filament/stock");
  },

  movements(limit = 100) {
    return api.get(`/api/inventory/filament/movements?limit=${limit}`);
  },

  add(payload) {
    return api.post("/api/inventory/filament/add", payload);
  },

  consume(payload) {
    return api.post("/api/inventory/filament/consume", payload);
  },

  adjust(payload) {
    return api.post("/api/inventory/filament/adjust", payload);
  },

  printerFilament() {
    return api.get("/api/inventory/printer-filament");
  },

  loadPrinterFilament(payload) {
    return api.post("/api/inventory/printer-filament/load", payload);
  },
};