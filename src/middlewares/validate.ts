import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { HttpError } from "./httpError.js";

export const validateBody =
  (schema: ZodType): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(new HttpError(400, "Dữ liệu không hợp lệ", result.error.flatten()));
    req.body = result.data;
    next();
  };
