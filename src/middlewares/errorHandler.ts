import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError } from "./httpError.js";

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, "Không tìm thấy route"));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // Lỗi từ Google API (gaxios) có err.code là HTTP status
  const googleStatus = typeof err?.code === "number" ? err.code : undefined;
  const status = err instanceof HttpError ? err.status : (googleStatus ?? 500);
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: err.message ?? "Lỗi máy chủ",
    ...(err instanceof HttpError && err.details ? { details: err.details } : {}),
  });
};
