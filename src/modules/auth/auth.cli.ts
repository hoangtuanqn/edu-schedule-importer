import { exec } from "node:child_process";
import { createApp } from "../../app.js";
import { env } from "../../config/env.js";
import type { OAuth2Client } from "../../config/google.js";
import { getAuthorizedClient } from "./auth.service.js";

const TIMEOUT_MS = 5 * 60 * 1000;

function openBrowser(url: string) {
  const cmd =
    process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
}

/** Mở trình duyệt để đăng nhập Google, chờ đến khi có token rồi trả về client. Dùng khi chạy CLI. */
export async function loginInteractive(): Promise<OAuth2Client> {
  const server = createApp().listen(env.port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const url = `http://localhost:${env.port}/auth/google`;
  console.log(`Cần đăng nhập Google. Đang mở trình duyệt: ${url}`);
  openBrowser(url);

  try {
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      const client = await getAuthorizedClient();
      if (client) return client;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Hết 5 phút mà chưa đăng nhập Google");
  } finally {
    server.close();
  }
}
