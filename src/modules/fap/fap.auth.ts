import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../../config/env.js";
import { HttpError } from "../../middlewares/httpError.js";

/** Bảo vệ endpoint nhận dữ liệu từ userscript bằng mã bí mật IMPORT_TOKEN trong .env */
export const requireImportToken: RequestHandler = (req, _res, next) => {
  const expected = env.importToken;
  if (!expected) return next(new HttpError(503, "Chưa cấu hình IMPORT_TOKEN trong .env"));

  const got = Buffer.from(String(req.header("x-import-token") ?? ""));
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return next(new HttpError(401, "Sai IMPORT_TOKEN"));
  next();
};
