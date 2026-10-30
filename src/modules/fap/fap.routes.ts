import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { validateBody } from "../../middlewares/validate.js";
import { requireGoogleAuth } from "../auth/auth.middleware.js";
import { requireImportToken } from "./fap.auth.js";
import * as service from "./fap.service.js";

const week = z.object({
  /** HTML bảng lịch của một tuần */
  html: z.string().min(50).max(500_000),
  /** Ngày đã dùng để gọi FAP, giúp suy ra năm */
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Nhận `{ weeks: [...] }` (nhiều tuần) hoặc `{ html }` (một tuần, tương thích bản cũ) và quy về danh sách tuần */
const importSchema = z.union([
  z.object({ weeks: z.array(week).min(1).max(60) }),
  z.object({ html: week.shape.html }).transform((b) => ({ weeks: [{ html: b.html }] })),
]);

const router = Router();

// Userscript gọi: POST /api/fap/import  (header x-import-token). Thêm ?dryRun=true để chạy thử
router.post(
  "/import",
  requireImportToken,
  requireGoogleAuth,
  validateBody(importSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.importWeeks(req.googleAuth!, req.body.weeks, req.query.dryRun === "true"));
  }),
);

export default router;
