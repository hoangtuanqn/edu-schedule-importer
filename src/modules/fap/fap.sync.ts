import { createHash } from "node:crypto";
import type { calendar_v3 } from "googleapis";
import type { Db } from "../../db/database.js";
import type { CalendarGateway } from "../events/calendar.gateway.js";
import { EVENT_COLORS, type LmsConfig } from "../lms/lms.config.js";
import type { ParsedWeek } from "./fap.parser.js";
import { FapRepository, type FapChange, type StoredSession } from "./fap.repository.js";
import { addDays, todayIn } from "./fap.time.js";

/** Chỉ đối chiếu/khôi phục buổi có ngày trong 10 ngày trở lại hoặc ở tương lai (giống LMS) */
export const RESTORE_WINDOW_DAYS = 10;

/** Một hoặc nhiều tuần đã đọc từ FAP. Mỗi tuần được xử lý độc lập: buổi biến mất khỏi tuần nào thì chỉ tính "mất" trong tuần đó. */
export interface FapImport {
  weeks: ParsedWeek[];
  /** Cảnh báo chung, ví dụ tuần không tải/đọc được nên bị bỏ qua */
  warnings?: string[];
}

export interface FapReport {
  startedAt: string;
  durationMs: number;
  dryRun: boolean;
  timeZone: string;
  /** Môn bị loại trừ theo cấu hình fap.ignoreCourses (mặc định không loại môn nào) */
  excludedCourses: string[];
  /** Khoảng ngày vừa nhập (gồm `weeks` tuần); undefined nếu chỉ đối chiếu lại dữ liệu đã lưu */
  range?: { start: string; end: string; weeks: number };
  parsedTotal: number;
  ignoredCourses: string[];
  warnings: string[];
  newlyStored: number;
  created: StoredSession[];
  updated: StoredSession[];
  restored: StoredSession[];
  /** Buổi đã có mà FAP đổi giờ / phòng / giảng viên / hình thức, kèm giá trị trước và sau */
  changed: (StoredSession & { changes: FapChange[] })[];
  /** Buổi biến mất khỏi tuần vừa nhập (bị hủy hoặc dời) */
  missing: StoredSession[];
  unchanged: number;
  errors: (StoredSession & { error: string })[];
  notifications?: { channel: string; ok: boolean; error?: string }[];
}

export interface FapSyncInput {
  db: Db;
  cfg: LmsConfig;
  gateway: CalendarGateway;
  /** Bỏ trống = không nhập gì mới, chỉ đối chiếu lại dữ liệu đã lưu (khôi phục sự kiện bị xóa...) */
  import?: FapImport;
  dryRun?: boolean;
  now?: Date;
}

/** "P.124" -> "124"; "213" -> "213" */
const roomLabel = (room: string) => room.replace(/^P\.?\s*/i, "");

export function toGoogleEvent(s: StoredSession, cfg: LmsConfig): calendar_v3.Schema$Event {
  const f = cfg.fap;
  const exam = s.kind === "exam";
  const color = exam ? f.examColor : f.classColor;
  const reminders = [...new Set(exam ? f.examReminderMinutes : f.classReminderMinutes)].sort((a, b) => b - a);

  const description = [
    exam ? "Lịch thi" : "Lịch học",
    s.className && `Lớp: ${s.className}`,
    `Giờ: ${s.startTime} - ${s.endTime} (slot ${s.slot})`,
    `Hình thức: ${s.online ? "Online" : "Offline"}`,
    s.meetUrl && `Link Meet: ${s.meetUrl}`,
    `Phòng: ${s.room ? roomLabel(s.room) : "(chưa có)"}`,
    `Giảng viên: ${s.lecturer ?? "(chưa có)"}`,
    "Nguồn: FAP",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    summary: `${exam ? "[Thi] " : ""}${s.courseCode}${s.className ? ` - ${s.className}` : ""}`,
    // null = xóa giá trị cũ khi cập nhật (ví dụ phòng bị bỏ trống)
    // Lớp online: đặt link Meet làm địa điểm để bấm vào là vào lớp
    location: s.online ? (s.meetUrl ?? "Online") : s.room ? `Phòng ${roomLabel(s.room)}` : null,
    description,
    colorId: color ? EVENT_COLORS[color] : null,
    start: { dateTime: `${s.date}T${s.startTime}:00`, timeZone: cfg.timeZone },
    end: { dateTime: `${s.date}T${s.endTime}:00`, timeZone: cfg.timeZone },
    reminders: { useDefault: false, overrides: reminders.map((minutes) => ({ method: "popup", minutes })) },
    extendedProperties: { private: { fapId: s.id } },
  };
}

/** Đổi bất kỳ trường nào của buổi (giờ, phòng, giảng viên...) hoặc cấu hình thì hash đổi => cập nhật lại Google */
export const contentHash = (s: StoredSession, cfg: LmsConfig) =>
  createHash("sha1").update(JSON.stringify(toGoogleEvent(s, cfg))).digest("hex");

export async function runFapSync(input: FapSyncInput): Promise<FapReport> {
  const t0 = Date.now();
  const { db, cfg, gateway, dryRun = false } = input;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const repo = new FapRepository(db);

  const report: FapReport = {
    startedAt: nowIso,
    durationMs: 0,
    dryRun,
    timeZone: cfg.timeZone,
    excludedCourses: cfg.fap.ignoreCourses,
    range: input.import?.weeks.length
      ? {
          start: input.import.weeks.map((w) => w.weekStart).sort()[0],
          end: input.import.weeks.map((w) => w.weekEnd).sort().at(-1)!,
          weeks: input.import.weeks.length,
        }
      : undefined,
    parsedTotal: input.import?.weeks.reduce((n, w) => n + w.sessions.length, 0) ?? 0,
    ignoredCourses: [],
    warnings: [...(input.import?.warnings ?? []), ...(input.import?.weeks.flatMap((w) => w.warnings) ?? [])],
    newlyStored: 0,
    created: [],
    updated: [],
    restored: [],
    changed: [],
    missing: [],
    unchanged: 0,
    errors: [],
  };

  // 1. Lưu các buổi vừa nhập. Lịch FAP là lịch riêng của bạn nên lấy TẤT CẢ, chỉ bỏ môn nằm trong fap.ignoreCourses
  const excluded = cfg.fap.ignoreCourses;
  if (input.import) {
    const skip = new Set(excluded);
    const ignored = new Set<string>();
    for (const week of input.import.weeks) {
      const seen = new Set<string>();
      for (const s of week.sessions) {
        if (skip.has(s.courseCode)) {
          ignored.add(s.courseCode);
          continue;
        }
        seen.add(s.id);
        const { stored, isNew, changes } = repo.upsert(s, nowIso);
        if (isNew) report.newlyStored++;
        else if (changes.length) report.changed.push({ ...stored, changes });
      }
      report.missing.push(...repo.markMissing(week.weekStart, week.weekEnd, seen, excluded));
    }
    report.ignoredCourses = [...ignored].sort();
  }

  // 2. Đối chiếu với Google Calendar
  const since = addDays(todayIn(cfg.timeZone, now), -RESTORE_WINDOW_DAYS);
  for (const s of repo.candidates(since, excluded)) {
    try {
      const hash = contentHash(s, cfg);
      let kind: "created" | "updated" | "restored" | "unchanged";
      if (!s.syncedAt) kind = "created";
      else if ((await gateway.status(s.googleEventId)) !== "exists") kind = "restored";
      else kind = s.syncedHash !== hash ? "updated" : "unchanged";

      if (kind === "unchanged") {
        report.unchanged++;
        continue;
      }
      if (!dryRun) {
        const usedId = await gateway.upsert(s.googleEventId, toGoogleEvent(s, cfg));
        repo.markSynced(s.id, hash, nowIso, kind === "restored", gateway.calendarId, usedId);
      }
      report[kind].push(s);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("invalid_grant") || /\b401\b/.test(message)) throw err;
      report.errors.push({ ...s, error: message });
    }
  }

  report.durationMs = Date.now() - t0;
  return report;
}
