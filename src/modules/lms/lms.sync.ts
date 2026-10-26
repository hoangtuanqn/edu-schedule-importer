import { createHash } from "node:crypto";
import type { calendar_v3 } from "googleapis";
import type { Db } from "../../db/database.js";
import type { CalendarGateway } from "../events/calendar.gateway.js";
import { EVENT_COLORS, type LmsConfig } from "./lms.config.js";
import type { LmsEvent } from "./lms.ical.js";
import { LmsRepository, type FieldChange, type StoredEvent } from "./lms.repository.js";

const DAY = 24 * 3600 * 1000;
/** LMS xuất lịch từ 5 ngày trước: sự kiện cũ hơn mốc này mà không còn trong feed là bình thường */
export const LMS_LOOKBACK_DAYS = 5;
/** Chỉ khôi phục sự kiện bị xóa trên Google nếu hạn của nó trong vòng 10 ngày trở lại (hoặc ở tương lai) */
export const RESTORE_WINDOW_DAYS = 10;

export type { CalendarGateway } from "../events/calendar.gateway.js";

export interface ReportItem {
  uid: string;
  courseCode: string; // "PRO192"
  title: string; // "Assignment is due"
  summary: string; // "[PRO192] Assignment is due"
  dueAt: string;
}

export interface SyncReport {
  startedAt: string;
  durationMs: number;
  dryRun: boolean;
  timeZone: string;
  courses: string[];
  feedTotal: number; // tổng sự kiện LMS trả về (mọi môn)
  ignoredCourses: string[];
  newlyStored: number; // sự kiện lần đầu thấy, vừa lưu vào DB
  created: ReportItem[];
  updated: ReportItem[];
  restored: ReportItem[];
  /** Sự kiện đã tạo trước đó ở lịch khác, vừa được chuyển sang lịch đích */
  moved: ReportItem[];
  unchanged: number;
  /** Sự kiện đã tồn tại mà LMS đổi tiêu đề / mô tả / hạn nộp, kèm giá trị trước và sau */
  changedInLms: (ReportItem & { changes: FieldChange[] })[];
  missingInLms: ReportItem[];
  errors: (ReportItem & { error: string })[];
  /** Kết quả gửi thông báo (điền bởi lms.service, không phải runSync) */
  notifications?: { channel: string; ok: boolean; error?: string }[];
}

export interface SyncInput {
  db: Db;
  cfg: LmsConfig;
  lmsEvents: LmsEvent[]; // đã lọc theo môn
  feedTotal: number;
  ignoredCourses: string[];
  gateway: CalendarGateway;
  dryRun?: boolean;
  now?: Date;
}

/** Lời nhắc popup của Google, tính từ lúc BẮT ĐẦU sự kiện. Sự kiện bắt đầu sớm hơn hạn
 *  `lead` phút, nên phải TRỪ `lead` để lời nhắc rơi đúng vào "m phút trước hạn nộp".
 *  Mốc gần hạn hơn thời lượng sự kiện thì không đặt được trước lúc bắt đầu => nhắc ngay lúc bắt đầu (0). */
function remindersFor(cfg: LmsConfig, lead: number): calendar_v3.Schema$Event["reminders"] {
  const minutes = [...new Set(cfg.reminderMinutes.map((m) => Math.max(m - lead, 0)))].sort((a, b) => b - a);
  return { useDefault: false, overrides: minutes.map((m) => ({ method: "popup", minutes: m })) };
}

export function toGoogleEvent(e: StoredEvent, cfg: LmsConfig): calendar_v3.Schema$Event {
  const base = {
    summary: `[${e.courseCode}] ${e.summary}`,
    // null = xóa màu riêng để sự kiện lấy màu của lịch chứa nó
    colorId: cfg.eventColor ? EVENT_COLORS[cfg.eventColor] : null,
    description: [e.description, `Nguồn: LMS (${e.courseLabel})`].filter(Boolean).join("\n\n"),
    extendedProperties: { private: { lmsUid: e.uid } },
  };
  const due = new Date(e.dueAt);
  if (e.allDay) {
    return {
      ...base,
      start: { date: due.toISOString().slice(0, 10) },
      end: { date: new Date(due.getTime() + DAY).toISOString().slice(0, 10) },
      reminders: remindersFor(cfg, 0),
    };
  }
  const start = new Date(due.getTime() - cfg.eventDurationMinutes * 60 * 1000);
  return {
    ...base,
    reminders: remindersFor(cfg, cfg.eventDurationMinutes),
    start: { dateTime: start.toISOString(), timeZone: cfg.timeZone },
    end: { dateTime: due.toISOString(), timeZone: cfg.timeZone },
  };
}

/** Hash của thứ sẽ được đẩy lên Google: đổi nội dung LMS hoặc đổi config (thời lượng, múi giờ) đều làm hash đổi */
export const contentHash = (e: StoredEvent, cfg: LmsConfig) =>
  createHash("sha1").update(JSON.stringify(toGoogleEvent(e, cfg))).digest("hex");

const item = (e: Pick<StoredEvent, "uid" | "summary" | "dueAt" | "courseCode">): ReportItem => ({
  uid: e.uid,
  courseCode: e.courseCode,
  title: e.summary,
  summary: `[${e.courseCode}] ${e.summary}`,
  dueAt: e.dueAt,
});

export async function runSync(input: SyncInput): Promise<SyncReport> {
  const t0 = Date.now();
  const { db, cfg, gateway, dryRun = false } = input;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const repo = new LmsRepository(db);

  const report: SyncReport = {
    startedAt: nowIso,
    durationMs: 0,
    dryRun,
    timeZone: cfg.timeZone,
    courses: cfg.courses,
    feedTotal: input.feedTotal,
    ignoredCourses: input.ignoredCourses,
    newlyStored: 0,
    created: [],
    updated: [],
    restored: [],
    moved: [],
    unchanged: 0,
    changedInLms: [],
    missingInLms: [],
    errors: [],
  };

  // 1. Lưu sự kiện từ LMS vào DB
  const seen = new Set<string>();
  for (const e of input.lmsEvents) {
    seen.add(e.uid);
    const { isNew, changes } = repo.upsertFromLms(e, nowIso);
    if (isNew) report.newlyStored++;
    else if (changes.length) {
      report.changedInLms.push({
        ...item({ uid: e.uid, courseCode: e.courseCode, summary: e.summary, dueAt: e.end.toISOString() }),
        changes,
      });
    }
  }

  // 2. Sự kiện còn trong cửa sổ LMS mà LMS không trả về nữa => đã bị xóa trên LMS
  const windowStart = new Date(now.getTime() - LMS_LOOKBACK_DAYS * DAY).toISOString();
  report.missingInLms = repo.markMissing(cfg.courses, seen, windowStart).map(item);

  // 3. Đối chiếu với Google Calendar, chỉ xét sự kiện có hạn trong 10 ngày trở lại và tương lai
  const since = new Date(now.getTime() - RESTORE_WINDOW_DAYS * DAY).toISOString();
  for (const e of repo.candidates(cfg.courses, since)) {
    try {
      const hash = contentHash(e, cfg);
      let kind: "created" | "updated" | "restored" | "unchanged";

      // Sự kiện đã đẩy lên trước đó nhưng đang ở lịch khác (ví dụ lịch chính) => chuyển sang lịch đích
      let justMoved = false;
      const from = e.googleCalendarId ?? "primary";
      if (e.syncedAt && from !== gateway.calendarId && (await gateway.status(e.googleEventId, from)) === "exists") {
        if (!dryRun) {
          await gateway.move(e.googleEventId, from);
          repo.markMoved(e.uid, gateway.calendarId);
        }
        report.moved.push(item(e));
        justMoved = true;
      }

      if (!e.syncedAt) {
        kind = "created";
      } else if (!justMoved && (await gateway.status(e.googleEventId)) !== "exists") {
        kind = "restored"; // đã từng đẩy lên, giờ không còn trên Google => bị xóa
      } else {
        kind = e.syncedHash !== hash ? "updated" : "unchanged";
      }

      if (kind === "unchanged") {
        report.unchanged++;
        continue;
      }
      if (!dryRun) {
        const usedId = await gateway.upsert(e.googleEventId, toGoogleEvent(e, cfg));
        repo.markSynced(e.uid, hash, nowIso, kind === "restored", gateway.calendarId, usedId);
      }
      report[kind].push(item(e));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Lỗi đăng nhập thì dừng hẳn để nơi gọi xử lý, không ghi nhận từng sự kiện
      if (message.includes("invalid_grant") || /\b401\b/.test(message)) throw err;
      report.errors.push({ ...item(e), error: message });
    }
  }

  report.durationMs = Date.now() - t0;
  if (!dryRun) {
    repo.recordRun({
      startedAt: nowIso,
      durationMs: report.durationMs,
      dryRun,
      created: report.created.length,
      updated: report.updated.length,
      restored: report.restored.length,
      unchanged: report.unchanged,
      errors: report.errors.length,
    });
  }
  return report;
}
