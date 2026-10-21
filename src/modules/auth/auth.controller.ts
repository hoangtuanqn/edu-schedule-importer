import type { Request, Response } from "express";
import { HttpError } from "../../middlewares/httpError.js";
import * as service from "./auth.service.js";

export function login(_req: Request, res: Response) {
  res.redirect(service.getAuthUrl());
}

export async function callback(req: Request, res: Response) {
  const code = req.query.code;
  if (typeof code !== "string") throw new HttpError(400, req.query.error?.toString() ?? "Thiếu code");
  await service.handleCallback(code);
  res.send("Đăng nhập Google thành công. Bạn có thể dùng API /api/events.");
}

export async function status(_req: Request, res: Response) {
  res.json({ authenticated: !!(await service.getAuthorizedClient()) });
}

export async function logout(_req: Request, res: Response) {
  await service.logout();
  res.status(204).end();
}
