import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/database.js";

const DAY = 24 * 3600 * 1000;

/** File log do job chạy ngầm tạo ra: sync-2026-11-01.log (và sync.log của phiên bản cũ) */
export const LOG_FILE_PATTERN = /^sync.*\.log$/;

/** Trạng thái cảnh báo chỉ cần nhớ 24 giờ, giữ 30 ngày là dư */
export const ALERT_STATE_KEEP_DAYS = 30;

export interface CleanupOptions {
  logDir: string;
  /** Xóa file log không được ghi trong ngần này ngày. 0 = không xóa */
  logKeepDays: number;
  /** Xóa lịch sử các lần chạy (bảng sync_runs) cũ hơn ngần này ngày. 0 = không xóa */
  historyKeepDays: number;
  /** Chỉ đếm xem sẽ xóa gì, không xóa thật */
  dryRun?: boolean;
  now?: Date;
}

export interface CleanupSummary {
  deletedFiles: string[];
  freedBytes: number;
  prunedRuns: number;
  prunedStates: number;
  dryRun: boolean;
}

/**
 * Xóa file log cũ. Dựa vào thời điểm file được ghi lần cuối (không phụ thuộc tên file), nên file của ngày hôm nay
 * (đang được ghi) không bao giờ bị đụng tới. Chỉ xóa file khớp `LOG_FILE_PATTERN` trong đúng thư mục log.
 */
export function cleanupLogFiles(dir: string, keepDays: number, now: Date, dryRun = false) {
  const result = { deleted: [] as string[], freedBytes: 0 };
  if (keepDays <= 0 || !fs.existsSync(dir)) return result;

  const cutoff = now.getTime() - keepDays * DAY;
  for (const name of fs.readdirSync(dir)) {
    if (!LOG_FILE_PATTERN.test(name)) continue;
    const file = path.join(dir, name);
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.mtimeMs >= cutoff) continue;
      if (!dryRun) fs.unlinkSync(file);
      result.deleted.push(name);
      result.freedBytes += stat.size;
    } catch {
      // đang bị chương trình khác giữ hoặc không đủ quyền: bỏ qua, lần sau thử lại
    }
  }
  return result;
}

/** Cắt bớt lịch sử trong DB: các lần chạy cũ và trạng thái cảnh báo đã quá hạn */
export function pruneHistory(db: Db, keepDays: number, now: Date, dryRun = false) {
  const cutoff = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  const run = (select: string, del: string, arg: string): number => {
    if (dryRun) return Number((db.prepare(select).get(arg) as { n: number }).n);
    return Number(db.prepare(del).run(arg).changes);
  };

  const prunedRuns =
    keepDays > 0
      ? run("SELECT count(*) n FROM sync_runs WHERE started_at < ?", "DELETE FROM sync_runs WHERE started_at < ?", cutoff(keepDays))
      : 0;
  const prunedStates = run(
    "SELECT count(*) n FROM app_state WHERE key LIKE 'alert:%' AND updated_at < ?",
    "DELETE FROM app_state WHERE key LIKE 'alert:%' AND updated_at < ?",
    cutoff(ALERT_STATE_KEEP_DAYS),
  );
  return { prunedRuns, prunedStates };
}

export function runMaintenance(db: Db, opts: CleanupOptions): CleanupSummary {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const files = cleanupLogFiles(opts.logDir, opts.logKeepDays, now, dryRun);
  const history = pruneHistory(db, opts.historyKeepDays, now, dryRun);
  return { deletedFiles: files.deleted, freedBytes: files.freedBytes, dryRun, ...history };
}

const kb = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

/** Một dòng mô tả kết quả; null nếu không có gì để dọn */
export function describeCleanup(s: CleanupSummary): string | null {
  const parts = [
    s.deletedFiles.length && `${s.deletedFiles.length} file log cũ (${kb(s.freedBytes)})`,
    s.prunedRuns && `${s.prunedRuns} bản ghi lịch sử chạy`,
    s.prunedStates && `${s.prunedStates} trạng thái cảnh báo hết hạn`,
  ].filter(Boolean);
  if (!parts.length) return null;
  return `Dọn dẹp: ${s.dryRun ? "sẽ xóa" : "đã xóa"} ${parts.join(", ")}.`;
}
