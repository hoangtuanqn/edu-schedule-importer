import type { calendar_v3 } from "googleapis";
import type { OAuth2Client } from "../../config/google.js";
import * as events from "./events.service.js";

/** Cầu nối tới Google Calendar, dùng chung cho mọi nguồn đồng bộ (LMS, FAP...) và dễ thay bằng bản giả khi test */
export interface CalendarGateway {
  /** Id lịch Google đích */
  readonly calendarId: string;
  /** Trạng thái sự kiện trong lịch đích, hoặc trong lịch `inCalendarId` nếu truyền vào */
  status(eventId: string, inCalendarId?: string): Promise<"exists" | "deleted" | "missing">;
  /** Trả về id sự kiện thực sự được dùng (có thể khác `eventId` nếu id cũ là bản đã xóa) */
  upsert(eventId: string, body: calendar_v3.Schema$Event): Promise<string>;
  /** Chuyển sự kiện từ lịch khác về lịch đích (giữ nguyên id) */
  move(eventId: string, fromCalendarId: string): Promise<void>;
}

export const googleGateway = (auth: OAuth2Client, calendarId: string): CalendarGateway => ({
  calendarId,
  status: (id, inCalendarId = calendarId) => events.getStatus(auth, id, inCalendarId),
  upsert: async (id, body) => (await events.upsert(auth, id, body, calendarId)).eventId,
  move: (id, from) => events.move(auth, id, from, calendarId),
});
