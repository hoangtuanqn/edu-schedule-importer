import type { Db } from "../../db/database.js";
import { notify } from "./notify.service.js";
import type { NotificationChannel, NotificationMessage, NotifyResult } from "./notify.types.js";

export const ALERT_COOLDOWN_MS = 24 * 3600 * 1000;

export interface AlertOutcome {
  /** sent: đã gửi · cooldown: vừa cảnh báo gần đây nên bỏ qua · no-channel: chưa bật kênh nào · failed: kênh có bật nhưng gửi lỗi */
  status: "sent" | "cooldown" | "no-channel" | "failed";
  results: NotifyResult[];
}

/**
 * Gửi cảnh báo cho một sự cố, nhưng không quá một lần mỗi `cooldownMs` cho cùng `key`.
 * Dùng cho job chạy ngầm: lỗi lặp lại mỗi lần chạy thì chỉ báo một lần mỗi ngày, không spam hộp thư.
 *
 * Chỉ ghi nhận "đã cảnh báo" khi thật sự gửi được; chưa có kênh nào hoặc gửi lỗi thì lần sau thử lại.
 */
export async function alertOnce(
  db: Db,
  key: string,
  message: NotificationMessage,
  opts: { now?: Date; cooldownMs?: number; channels?: NotificationChannel[] } = {},
): Promise<AlertOutcome> {
  const now = opts.now ?? new Date();
  const cooldownMs = opts.cooldownMs ?? ALERT_COOLDOWN_MS;
  const stateKey = `alert:${key}`;

  const last = db.prepare("SELECT value FROM app_state WHERE key = ?").get(stateKey) as { value: string } | undefined;
  if (last && now.getTime() - Date.parse(last.value) < cooldownMs) return { status: "cooldown", results: [] };

  const results = await notify(message, opts.channels);
  if (!results.length) return { status: "no-channel", results };
  if (!results.some((r) => r.ok)) return { status: "failed", results };

  db.prepare(
    `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(stateKey, now.toISOString(), now.toISOString());
  return { status: "sent", results };
}
