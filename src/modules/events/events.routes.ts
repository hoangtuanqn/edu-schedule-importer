import { Router } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { validateBody } from "../../middlewares/validate.js";
import { requireGoogleAuth } from "../auth/auth.middleware.js";
import * as c from "./events.controller.js";
import { createEventSchema, updateEventSchema } from "./events.schema.js";

const router = Router();
router.use(requireGoogleAuth);

router.get("/", asyncHandler(c.list));
router.get("/:id", asyncHandler(c.get));
router.post("/", validateBody(createEventSchema), asyncHandler(c.create));
router.patch("/:id", validateBody(updateEventSchema), asyncHandler(c.update));
router.delete("/:id", asyncHandler(c.remove));

export default router;
