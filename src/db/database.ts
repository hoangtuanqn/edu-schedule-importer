import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lms_events (
  uid             TEXT PRIMARY KEY,            -- id sự kiện trên LMS
  course_code     TEXT NOT NULL,
  course_label    TEXT NOT NULL,
  summary         TEXT NOT NULL,
  description     TEXT NOT NULL,
  due_at          TEXT NOT NULL,               -- ISO UTC (toISOString) nên so sánh chuỗi = so sánh thời gian
  all_day         INTEGER NOT NULL DEFAULT 0,
  google_event_id TEXT NOT NULL,
  google_calendar_id TEXT,                     -- lịch Google đang chứa sự kiện; NULL = lịch chính (bản cũ)
  synced_hash     TEXT,                        -- hash nội dung đã đẩy lên Google lần gần nhất
  synced_at       TEXT,                        -- NULL = chưa từng đẩy lên Google
  restored_count  INTEGER NOT NULL DEFAULT 0,  -- số lần bị xóa trên Google và được khôi phục
  missing_in_lms  INTEGER NOT NULL DEFAULT 0,  -- 1 = LMS không còn trả về sự kiện này
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lms_events_due ON lms_events(due_at);

-- Buổi học / buổi thi lấy từ FAP
CREATE TABLE IF NOT EXISTS fap_sessions (
  id                 TEXT PRIMARY KEY,           -- hash của loại + môn + lớp + ngày + slot
  kind               TEXT NOT NULL,              -- 'class' | 'exam'
  course_code        TEXT NOT NULL,
  class_name         TEXT NOT NULL,
  date               TEXT NOT NULL,              -- YYYY-MM-DD (giờ địa phương, không có múi giờ)
  slot               INTEGER NOT NULL,
  start_time         TEXT NOT NULL,              -- HH:mm
  end_time           TEXT NOT NULL,
  room               TEXT,
  lecturer           TEXT,
  online             INTEGER NOT NULL DEFAULT 0,
  meet_url           TEXT,                       -- link Meet của lớp online
  google_event_id    TEXT NOT NULL,
  google_calendar_id TEXT,
  synced_hash        TEXT,
  synced_at          TEXT,                       -- NULL = chưa từng đẩy lên Google
  restored_count     INTEGER NOT NULL DEFAULT 0,
  missing            INTEGER NOT NULL DEFAULT 0, -- 1 = lần nhập gần nhất của tuần đó không còn buổi này
  first_seen_at      TEXT NOT NULL,
  last_seen_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fap_sessions_date ON fap_sessions(date);

CREATE TABLE IF NOT EXISTS sync_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  dry_run     INTEGER NOT NULL,
  created     INTEGER NOT NULL,
  updated     INTEGER NOT NULL,
  restored    INTEGER NOT NULL,
  unchanged   INTEGER NOT NULL,
  errors      INTEGER NOT NULL
);
`;

export function openDb(file: string): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Nâng cấp DB tạo từ phiên bản trước (CREATE TABLE IF NOT EXISTS không thêm cột mới vào bảng đã có) */
function migrate(db: Db) {
  const cols = (db.prepare("PRAGMA table_info(lms_events)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("google_calendar_id")) db.exec("ALTER TABLE lms_events ADD COLUMN google_calendar_id TEXT");

  const fapCols = (db.prepare("PRAGMA table_info(fap_sessions)").all() as { name: string }[]).map((c) => c.name);
  if (!fapCols.includes("meet_url")) db.exec("ALTER TABLE fap_sessions ADD COLUMN meet_url TEXT");
}
