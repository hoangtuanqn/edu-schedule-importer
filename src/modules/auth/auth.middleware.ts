import type { RequestHandler } from "express";
import type { OAuth2Client } from "../../config/google.js";
import { HttpError } from "../../middlewares/httpError.js";
import { getAuthorizedClient } from "./auth.service.js";

declare module "express-serve-static-core" {
  interface Request {
    googleAuth?: OAuth2Client;
  }
}

export const requireGoogleAuth: RequestHandler = async (req, _res, next) => {
  try {
    const client = await getAuthorizedClient();
    if (!client) throw new HttpError(401, "Chưa đăng nhập Google. Truy cập /auth/google");
    req.googleAuth = client;
    next();
  } catch (e) {
    next(e);
  }
};
