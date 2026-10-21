import fs from "node:fs/promises";
import { env } from "../../config/env.js";
import { createOAuthClient, SCOPES, type OAuth2Client } from "../../config/google.js";

type Tokens = Parameters<OAuth2Client["setCredentials"]>[0];

async function readTokens(): Promise<Tokens | null> {
  try {
    return JSON.parse(await fs.readFile(env.tokenPath, "utf8"));
  } catch {
    return null;
  }
}

async function saveTokens(tokens: Tokens) {
  const old = (await readTokens()) ?? {};
  await fs.writeFile(env.tokenPath, JSON.stringify({ ...old, ...tokens }, null, 2));
}

export function getAuthUrl(): string {
  return createOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

export async function handleCallback(code: string) {
  const { tokens } = await createOAuthClient().getToken(code);
  await saveTokens(tokens);
}

/** Trả về client đã có token, hoặc null nếu chưa đăng nhập */
export async function getAuthorizedClient(): Promise<OAuth2Client | null> {
  const tokens = await readTokens();
  if (!tokens) return null;
  const client = createOAuthClient();
  client.setCredentials(tokens);
  client.on("tokens", (t) => void saveTokens(t));
  return client;
}

export async function logout() {
  await fs.rm(env.tokenPath, { force: true });
}
