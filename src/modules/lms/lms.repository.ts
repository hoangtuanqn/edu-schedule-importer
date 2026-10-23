import type { Db } from "../../db/database.js";
import type { LmsEvent } from "./lms.ical.js";

export interface StoredEvent {
  uid: string;
  courseCode: string;
  courseLabel: string;
  summary: string;
  description: string;
  dueAt: string; // ISO UTC
  allDay: boolean;
  googleEventId: string;
  googleCalendarId: string | null; // null = lịch chính (dữ liệu từ bản cũ)
  syncedHash: string | null;
  syncedAt: string | null;
  restoredCount: number;
  missingInLms: boolean;
}

export interface FieldChange {
  field: "summary" | "description" | "dueAt";
  from: string;
  to: string;
}

type Row =Record<string, string | number | null>;

const fromRow = (r: Row): StoredEvent => ({
  uid: String(r.uid),
  courseCode: String(r.course_code),
  courseLabel: String(r.course_label),
  summary: String(r.summary),
  description: String(r.description),
  dueAt: String(r.due_at),
  allDay: r.all_day === 1,
  googleEventId: String(r.google_event_id),
  googleCalendarId: (r.google_calendar_id as string | null) ?? null,
  syncedHash: (r.synced_hash as string | null) ?? null,
  syncedAt: (r.synced_at as string | null) ?? null,
  restoredCount: Number(r.restored_count),
  missingInLms: r.missing_in_lms === 1,
});

/** Id Google chỉ cho phép a-v và 0-9; "lms" + uid số luôn hợp lệ và ổn định */
export const googleIdFor = (uid: string) => `lms${uid.toLowerCase().replace(/[^a-v0-9]/g, "")}`;

export class LmsRepository {
  constructor(private db: Db) {}

  /** Lưu/cập nhật sự kiện lấy từ LMS. Trả về isNew và các trường LMS đã đổi so với lần trước. */
  upsertFromLms(e: LmsEvent, nowIso: string): { isNew: boolean; changes: FieldChange[] } {
    const prev = this.db.prepare("SELECT * FROM lms_events WHERE uid = ?").get(e.uid) as Row | undefined;
    const changes: FieldChange[] = [];
    if (prev) {
      const next = { summary: e.summary, description: e.description, dueAt: e.end.toISOString() };
      const old = { summary: String(prev.summary), description: String(prev.description), dueAt: String(prev.due_at) };
      for (const field of ["summary", "description", "dueAt"] as const) {
        if (old[field] !== next[field]) changes.push({ field, from: old[field], to: next[field] });
      }
    }
    this.db
      .prepare(
        `INSERT INTO lms_events
           (uid, course_code, course_label, summary, description, due_at, all_day,
            google_event_id, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uid) DO UPDATE SET
           course_code = excluded.course_code, course_label = excluded.course_label,
           summary = excluded.summary, description = excluded.description,
           due_at = excluded.due_at, all_day = excluded.all_day,
           missing_in_lms = 0, last_seen_at = excluded.last_seen_at`,
      )
      .run(
        e.uid, e.courseCode, e.courseLabel, e.summary, e.description,
        e.end.toISOString(), e.allDay ? 1 : 0, googleIdFor(e.uid), nowIso, nowIso,
      );
    return { isNew: !prev, changes };
  }

  /**
   * Sự kiện nằm trong cửa sổ LMS (từ windowStartIso trở đi) mà LMS không trả về nữa
   * => đã bị xóa trên LMS. Đánh dấu và trả về danh sách sự kiện mới bị đánh dấu.
   */
  markMissing(courses: string[], seenUids: Set<string>, windowStartIso: string): StoredEvent[] {
    if (!courses.length) return [];
    const marks = courses.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT * FROM lms_events
         WHERE course_code IN (${marks}) AND missing_in_lms = 0 AND due_at >= ?`,
      )
      .all(...courses, windowStartIso) as Row[];
    const missing = rows.map(fromRow).filter((e) => !seenUids.has(e.uid));
    const mark = this.db.prepare("UPDATE lms_events SET missing_in_lms = 1 WHERE uid = ?");
    for (const e of missing) mark.run(e.uid);
    return missing.map((e) => ({ ...e, missingInLms: true }));
  }

  /** Sự kiện cần đối chiếu với Google: đúng môn, hạn từ sinceIso trở đi, LMS vẫn còn */
  candidates(courses: string[], sinceIso: string): StoredEvent[] {
    if (!courses.length) return [];
    const marks = courses.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT * FROM lms_events
         WHERE course_code IN (${marks}) AND due_at >= ? AND missing_in_lms = 0
         ORDER BY due_at`,
      )
      .all(...courses, sinceIso) as Row[];
    return rows.map(fromRow);
  }

  markSynced(uid: string, hash: string, nowIso: string, restored: boolean, calendarId: string, googleEventId: string) {
    this.db
      .prepare(
        `UPDATE lms_events
         SET synced_hash = ?, synced_at = ?, restored_count = restored_count + ?, google_calendar_id = ?,
             google_event_id = ?
         WHERE uid = ?`,
      )
      .run(hash, nowIso, restored ? 1 : 0, calendarId, googleEventId, uid);
  }

  /** Ghi nhận sự kiện đã được chuyển sang lịch khác */
  markMoved(uid: string, calendarId: string) {
    this.db.prepare("UPDATE lms_events SET google_calendar_id = ? WHERE uid = ?").run(calendarId, uid);
  }

  recordRun(r: {
    startedAt: string; durationMs: number; dryRun: boolean;
    created: number; updated: number; restored: number; unchanged: number; errors: number;
  }) {
    this.db
      .prepare(
        `INSERT INTO sync_runs (started_at, duration_ms, dry_run, created, updated, restored, unchanged, errors)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.startedAt, r.durationMs, r.dryRun ? 1 : 0, r.created, r.updated, r.restored, r.unchanged, r.errors);
  }
}
