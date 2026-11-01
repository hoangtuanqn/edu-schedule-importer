import path from "node:path";
import { env } from "./config/env.js";
import { closeDb, getDb } from "./db/connection.js";
import { describeCleanup, runMaintenance } from "./maintenance/cleanup.js";

/**
 * Dọn log và lịch sử cũ ngay (npm start cũng tự dọn sau mỗi lần chạy).
 *   npm run cleanup                 dọn thật
 *   npm run cleanup -- --dry-run    chỉ cho biết sẽ xóa gì
 */
const dryRun = process.argv.includes("--dry-run");

try {
  const summary = runMaintenance(getDb(), {
    logDir: path.join(process.cwd(), "logs"),
    logKeepDays: env.logRetentionDays,
    historyKeepDays: env.historyRetentionDays,
    dryRun,
  });
  console.log(
    `Giữ log ${env.logRetentionDays || "vô hạn"} ngày, lịch sử chạy ${env.historyRetentionDays || "vô hạn"} ngày ` +
      "(chỉnh bằng LOG_RETENTION_DAYS và HISTORY_RETENTION_DAYS trong .env).",
  );
  for (const f of summary.deletedFiles) console.log(`  ${dryRun ? "sẽ xóa" : "đã xóa"}: logs/${f}`);
  console.log(describeCleanup(summary) ?? "Không có gì để dọn.");
} finally {
  closeDb();
}
