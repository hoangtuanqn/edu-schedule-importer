import { google } from "googleapis";
import { env } from "./env.js";

export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export const SCOPES = ["https://www.googleapis.com/auth/calendar"];

export function createOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleRedirectUri);
}
