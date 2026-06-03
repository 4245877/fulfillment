import type { FastifyPluginAsync } from "fastify";

import printersRoutes from "./printers/routes";
import inventoryRoutes from "./inventory/routes";
import backupsRoutes from "./backups/routes";
import productReportsRoutes from "./productReports/routes";
import ordersRoutes from "./orders/routes";

const modulesRoutes: FastifyPluginAsync = async (app) => {
  app.register(printersRoutes, { prefix: "/api/printers" });
  app.register(inventoryRoutes, { prefix: "/api/inventory" });
  app.register(backupsRoutes, { prefix: "/api/ops/backup" });
  app.register(productReportsRoutes, { prefix: "/api" });
  app.register(ordersRoutes, { prefix: "/api/orders" });
};

export default modulesRoutes;