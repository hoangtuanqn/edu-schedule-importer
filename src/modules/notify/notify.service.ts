import { emailChannel } from "./channels/email.channel.js";
import type { NotificationChannel, NotificationMessage, NotifyResult } from "./notify.types.js";

/** Thêm kênh mới (Telegram, Discord...) = viết một NotificationChannel rồi thêm vào đây */
const channels: NotificationChannel[] = [emailChannel];

/**
 * Gửi thông điệp qua mọi kênh đã được cấu hình. Không bao giờ throw:
 * lỗi gửi được trả về trong kết quả để việc chính (đồng bộ lịch...) không bị hỏng theo.
 */
export async function notify(
  message: NotificationMessage,
  list: NotificationChannel[] = channels,
): Promise<NotifyResult[]> {
  const results: NotifyResult[] = [];
  for (const ch of list.filter((c) => c.isEnabled())) {
    try {
      await ch.send(message);
      results.push({ channel: ch.name, ok: true });
    } catch (e) {
      results.push({ channel: ch.name, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
