import type { Db } from "../../db/database.js";
import type { FapSession, SessionKind } from "./fap.parser.js";

export interface StoredSession extends FapSession {
  googleEventId: string;
  googleCalendarId: string | null;
  syncedHash: string | null;
  syncedAt: string | null;
  restoredCount: number;
  missing: boolean;
}

export interface FapChange {
  field: "time" | "room" | "lecturer" | "online" | "meet";
  from: string;
  to: string;
}

type Row = Record<string, string | number | null>;

const fromRow = (r: Row): StoredSession => ({
  id: String(r.id),
  kind: String(r.kind) as SessionKind,
  courseCode: String(r.course_code),
  className: String(r.class_name),
  date: String(r.date),
  slot: Number(r.slot),
  startTime: String(r.start_time),
  endTime: String(r.end_time),
  room: (r.room as string | null) ?? null,
  lecturer: (r.lecturer as string | null) ?? null,
  online: r.online === 1,
  meetUrl: (r.meet_url as string | null) ?? null,
  googleEventId: String(r.google_event_id),
  googleCalendarId: (r.google_calendar_id as string | null) ?? null,
  syncedHash: (r.synced_hash as string | null) ?? null,
  syncedAt: (r.synced_at as string | null) ?? null,
  restoredCount: Number(r.restored_count),
  missing: r.missing === 1,
});

/** Id Google chỉ cho phép a-v và 0-9; "fap" + hex (0-9, a-f) luôn hợp lệ */
export const googleIdFor = (id: string) => `fap${id}`;

const show = (v: string | null) => v ?? "(trống)";

/** Điều kiện SQL loại các môn trong `exclude`; rỗng thì không loại môn nào */
const notIn = (exclude: string[]) => (exclude.length ? `AND course_code NOT IN (${exclude.map(() => "?").join(",")})` : "");

export class FapRepository {
  constructor(private db: Db) {}

  get(id: string): StoredSession | undefined {
    const row = this.db.prepare("SELECT * FROM fap_sessions WHERE id = ?").get(id) as Row | undefined;
    return row && fromRow(row);
  }

  /** Lưu/cập nhật một buổi. Trả về buổi sau khi lưu, có phải buổi mới không, và các trường đã đổi so với lần trước. */
  upsert(s: FapSession, nowIso: string): { stored: StoredSession; isNew: boolean; changes: FapChange[] } {
    const prev = this.get(s.id);
    const changes: FapChange[] = [];
    if (prev) {
      const t = (a: string, b: string) => `${a}-${b}`;
      if (t(prev.startTime, prev.endTime) !== t(s.startTime, s.endTime)) {
        changes.push({ field: "time", from: t(prev.startTime, prev.endTime), to: t(s.startTime, s.endTime) });
      }
      if (prev.room !== s.room) changes.push({ field: "room", from: show(prev.room), to: show(s.room) });
      if (prev.lecturer !== s.lecturer) changes.push({ field: "lecturer", from: show(prev.lecturer), to: show(s.lecturer) });
      if (prev.online !== s.online) {
        changes.push({ field: "online", from: prev.online ? "Online" : "Offline", to: s.online ? "Online" : "Offline" });
      }
      if (prev.meetUrl !== s.meetUrl) changes.push({ field: "meet", from: show(prev.meetUrl), to: show(s.meetUrl) });
    }
    this.db
      .prepare(
        `INSERT INTO fap_sessions
           (id, kind, course_code, class_name, date, slot, start_time, end_time, room, lecturer, online, meet_url,
            google_event_id, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           start_time = excluded.start_time, end_time = excluded.end_time, room = excluded.room,
           lecturer = excluded.lecturer, online = excluded.online, meet_url = excluded.meet_url, missing = 0, last_seen_at = excluded.last_seen_at`,
      )
      .run(
        s.id, s.kind, s.courseCode, s.className, s.date, s.slot, s.startTime, s.endTime,
        s.room, s.lecturer, s.online ? 1 : 0, s.meetUrl, googleIdFor(s.id), nowIso, nowIso,
      );
    return { stored: this.get(s.id)!, isNew: !prev, changes };
  }

  /**
   * Buổi nằm trong tuần vừa nhập (from..to) mà trang không còn hiển thị nữa => bị hủy hoặc dời.
   * Đánh dấu và trả về danh sách vừa bị đánh dấu.
   */
  markMissing(from: string, to: string, seen: Set<string>, exclude: string[] = []): StoredSession[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM fap_sessions
         WHERE date >= ? AND date <= ? AND missing = 0 ${notIn(exclude)}`,
      )
      .all(from, to, ...exclude) as Row[];
    const gone = rows.map(fromRow).filter((s) => !seen.has(s.id));
    const mark = this.db.prepare("UPDATE fap_sessions SET missing = 1 WHERE id = ?");
    for (const s of gone) mark.run(s.id);
    return gone.map((s) => ({ ...s, missing: true }));
  }

  /** Buổi cần đối chiếu với Google: từ ngày `sinceDate` trở đi, còn hiện trên FAP, trừ các môn bị loại trừ */
  candidates(sinceDate: string, exclude: string[] = []): StoredSession[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM fap_sessions
         WHERE date >= ? AND missing = 0 ${notIn(exclude)}
         ORDER BY date, start_time`,
      )
      .all(sinceDate, ...exclude) as Row[];
    return rows.map(fromRow);
  }

  markSynced(id: string, hash: string, nowIso: string, restored: boolean, calendarId: string, googleEventId: string) {
    this.db
      .prepare(
        `UPDATE fap_sessions
         SET synced_hash = ?, synced_at = ?, restored_count = restored_count + ?,
             google_calendar_id = ?, google_event_id = ?
         WHERE id = ?`,
      )
      .run(hash, nowIso, restored ? 1 : 0, calendarId, googleEventId, id);
  }
}
