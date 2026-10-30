import type { OAuth2Client } from "../../config/google.js";
import { getDb } from "../../db/connection.js";
import { HttpError } from "../../middlewares/httpError.js";
import { googleGateway } from "../events/calendar.gateway.js";
import * as events from "../events/events.service.js";
import { loadConfig, type LmsConfig } from "../lms/lms.config.js";
import { notify } from "../notify/notify.service.js";
import { buildFapNotification, hasFapChanges } from "./fap.notification.js";
import { parseWeeklyTimetable, weekContains, type ParsedWeek } from "./fap.parser.js";
import { runFapSync, type FapImport, type FapReport } from "./fap.sync.js";

async function run(auth: OAuth2Client, cfg: LmsConfig, imp: FapImport | undefined, dryRun: boolean): Promise<FapReport> {
  const calendarId = await events.resolveCalendarId(auth, cfg.fap.calendar);
  const report = await runFapSync({ db: getDb(), cfg, gateway: googleGateway(auth, calendarId), import: imp, dryRun });
  // Chạy thử thì không gửi thông báo; không đổi gì thì cũng không gửi
  if (!dryRun && hasFapChanges(report)) report.notifications = await notify(buildFapNotification(report));
  return report;
}

export interface WeekInput {
  /** HTML bảng lịch của một tuần (từ /WeeklyTimetable/WeekPartial hoặc trang lịch tuần) */
  html: string;
  /** Ngày dùng để gọi FAP (YYYY-MM-DD); giúp suy ra đúng năm vì tiêu đề cột chỉ có ngày/tháng */
  referenceDate?: string;
}

/**
 * Nhận HTML của một hoặc nhiều tuần từ userscript, lưu vào SQLite rồi đồng bộ MỘT lần lên Google Calendar
 * (một lần đối chiếu, một email), thay vì mỗi tuần một lần.
 *
 * Tuần nào không đọc được (ví dụ FAP trả trang đăng nhập) thì bị bỏ qua kèm cảnh báo. Quan trọng: tuần đó
 * KHÔNG được coi là "rỗng", nếu không mọi buổi trong tuần sẽ bị báo nhầm là đã bị hủy.
 */
export async function importWeeks(auth: OAuth2Client, inputs: WeekInput[], dryRun = false): Promise<FapReport> {
  const cfg = await loadConfig();
  const weeks: ParsedWeek[] = [];
  const warnings: string[] = [];

  for (const [i, w] of inputs.entries()) {
    try {
      const anchor = w.referenceDate ? new Date(`${w.referenceDate}T00:00:00Z`) : new Date();
      const parsed = parseWeeklyTimetable(w.html, anchor);
      if (w.referenceDate && !weekContains(parsed, w.referenceDate)) {
        warnings.push(`Yêu cầu tuần chứa ${w.referenceDate} nhưng FAP trả tuần ${parsed.weekStart} → ${parsed.weekEnd}`);
      }
      weeks.push(parsed);
    } catch (e) {
      warnings.push(`Bỏ qua tuần ${w.referenceDate ?? `#${i + 1}`}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (!weeks.length) {
    throw new HttpError(422, `Không đọc được tuần nào từ FAP (có thể chưa đăng nhập FAP): ${warnings[0] ?? ""}`);
  }
  return run(auth, cfg, { weeks, warnings }, dryRun);
}

/** Không nhập gì mới, chỉ đối chiếu lại các buổi đã lưu (khôi phục sự kiện bị xóa, cập nhật khi đổi cấu hình) */
export async function reconcile(auth: OAuth2Client, dryRun = false): Promise<FapReport> {
  return run(auth, await loadConfig(), undefined, dryRun);
}
