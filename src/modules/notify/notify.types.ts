/** Dòng chi tiết: chuỗi thường, hoặc một thay đổi "nhãn: cũ → mới" (render nổi bật cũ/mới) */
export type NotificationDetail = string | { label: string; from: string; to: string };

/** Một dòng trong mục thông báo */
export type NotificationItem =
  | string
  | {
      text: string; // dòng chính, in đậm
      meta?: string; // dòng phụ mờ bên dưới (ví dụ hạn nộp, còn bao lâu)
      details?: NotificationDetail[];
    };

export type Tone = "info" | "success" | "warning" | "danger";

export interface NotificationSection {
  heading: string;
  tone?: Tone;
  items: NotificationItem[];
  /** Tổng số mục thật nếu `items` đã bị rút gọn; tiêu đề hiện số này thay cho items.length */
  total?: number;
}

/**
 * Thông điệp độc lập với kênh gửi: module nào cũng tạo được, rồi đưa cho `notify()`.
 * Mỗi kênh (email, sau này là Telegram, Discord...) tự render theo cách của nó.
 */
export interface NotificationMessage {
  subject: string;
  title: string;
  /** Dòng xem trước hiện cạnh subject trong danh sách hộp thư (email client hiển thị) */
  preheader?: string;
  /** Các nhãn tóm tắt nhanh ngay dưới tiêu đề, ví dụ ["1 đổi hạn", "2 mới"] */
  highlights?: string[];
  intro?: string;
  sections: NotificationSection[];
  footer?: string;
}

export interface NotificationChannel {
  readonly name: string;
  /** Kênh chưa cấu hình (thiếu mật khẩu, token...) thì trả false để bị bỏ qua */
  isEnabled(): boolean;
  send(message: NotificationMessage): Promise<void>;
}

export interface NotifyResult {
  channel: string;
  ok: boolean;
  error?: string;
}
