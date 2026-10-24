import type { Request, Response } from "express";
import { loadConfig } from "./lms.config.js";
import * as service from "./lms.service.js";

export async function config(_req: Request, res: Response) {
  res.json(await loadConfig());
}

export async function preview(_req: Request, res: Response) {
  res.json(await service.getFilteredEvents());
}

export async function sync(req: Request, res: Response) {
  const dryRun = req.query.dryRun === "true";
  res.json(await service.syncNow(req.googleAuth!, dryRun));
}
