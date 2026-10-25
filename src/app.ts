import express from "express";
import { errorHandler, notFound } from "./middlewares/errorHandler.js";
import authRoutes from "./modules/auth/auth.routes.js";
import eventsRoutes from "./modules/events/events.routes.js";
import lmsRoutes from "./modules/lms/lms.routes.js";

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/auth", authRoutes);
  app.use("/api/events", eventsRoutes);
  app.use("/api/lms", lmsRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
