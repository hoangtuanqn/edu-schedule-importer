import { Router } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { requireGoogleAuth } from "../auth/auth.middleware.js";
import * as c from "./lms.controller.js";

const router = Router();

// Không cần đăng nhập Google: chỉ đọc LMS để xem trước
router.get("/config", asyncHandler(c.config));
router.get("/events", asyncHandler(c.preview));

// Cần đăng nhập Google: ghi vào Google Calendar. Thêm ?dryRun=true để chạy thử
router.post("/sync", requireGoogleAuth, asyncHandler(c.sync));

export default router;
