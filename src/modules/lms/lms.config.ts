import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { HttpError } from "../../middlewares/httpError.js";

const CONFIG_PATH = path.join(process.cwd(), "config", "courses.json");

/** Bảng màu sự kiện cố định của Google Calendar (colorId 1-11) */
export const EVENT_COLORS = {
  lavender: "1", sage: "2", grape: "3", flamingo: "4", banana: "5", tangerine: "6",
  peacock: "7", graphite: "8", blueberry: "9", basil: "10", tomato: "11",
} as const;
const EVENT_COLOR_NAMES = Object.keys(EVENT_COLORS) as [keyof typeof EVENT_COLORS, ...(keyof typeof EVENT_COLORS)[]];

/** Giới hạn của Google Calendar: 4 tuần */
const MAX_REMINDER_MINUTES = 40320;

const configSchema = z.object({
  /** Mã môn cần lấy, ví dụ ["MAD101", "PRO192"] (không phân biệt hoa thường) */
  courses: z.array(z.string().trim().min(1)).transform((a) => a.map((c) => c.toUpperCase())),
  /** Thời lượng sự kiện trên Google Calendar; sự kiện kết thúc đúng giờ hạn của LMS */
  eventDurationMinutes: z.number().int().min(0).max(1440).default(30),
  timeZone: z.string().default("Asia/Ho_Chi_Minh"),
  /**
   * Lịch Google chứa các sự kiện LMS: ghi tên lịch (khớp một phần, không phân biệt hoa thường,
   * ví dụ "Nhắc nhở" khớp "❗ Nhắc nhở"), hoặc id lịch, hoặc "primary" cho lịch chính.
   */
  calendar: z.string().trim().min(1).default("primary"),
  /** Màu riêng của sự kiện; "" = không đặt, sự kiện lấy màu của lịch chứa nó */
  eventColor: z.enum([...EVENT_COLOR_NAMES, ""]).default(""),
  /**
   * Báo trước hạn nộp bao nhiêu phút (Google Calendar tự nhắc dạng popup).
   * Mặc định: 1 tuần, 3 ngày, 1 ngày, 5 giờ. Google cho tối đa 5 mốc, mỗi mốc tối đa 4 tuần.
   */
  reminderMinutes: z
    .array(z.number().int().min(0).max(MAX_REMINDER_MINUTES))
    .max(5, "Google Calendar chỉ cho tối đa 5 lời nhắc")
    .default([7 * 1440, 3 * 1440, 1440, 5 * 60]),
});

export type LmsConfig = z.infer<typeof configSchema>;

/** Đọc lại file mỗi lần gọi nên sửa JSON xong không cần restart server */
export async function loadConfig(): Promise<LmsConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(CONFIG_PATH, "utf8");
  } catch {
    throw new HttpError(500, `Không đọc được ${CONFIG_PATH}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new HttpError(500, `config/courses.json không phải JSON hợp lệ: ${(e as Error).message}`);
  }
  const result = configSchema.safeParse(json);
  if (!result.success) {
    throw new HttpError(500, "config/courses.json không hợp lệ", result.error.flatten());
  }
  return result.data;
}
