import express from "express";
import { errorHandler, notFound } from "./middlewares/errorHandler.js";
import authRoutes from "./modules/auth/auth.routes.js";
import eventsRoutes from "./modules/events/events.routes.js";
import fapRoutes from "./modules/fap/fap.routes.js";
import lmsRoutes from "./modules/lms/lms.routes.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "5mb" })); // bảng lịch FAP gửi lên có thể vài trăm KB

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/auth", authRoutes);
  app.use("/api/events", eventsRoutes);
  app.use("/api/lms", lmsRoutes);
  app.use("/api/fap", fapRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
