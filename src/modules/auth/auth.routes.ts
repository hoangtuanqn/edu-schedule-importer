import { Router } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler.js";
import * as c from "./auth.controller.js";

const router = Router();

router.get("/google", c.login);
router.get("/google/callback", asyncHandler(c.callback));
router.get("/status", asyncHandler(c.status));
router.post("/logout", asyncHandler(c.logout));

export default router;
