import { env } from "../../config/env.js";
import type { OAuth2Client } from "../../config/google.js";
import { getDb } from "../../db/connection.js";
import { googleGateway } from "../events/calendar.gateway.js";
import * as events from "../events/events.service.js";
import { loadConfig, type LmsConfig } from "./lms.config.js";
import { fetchIcal, type LmsEvent } from "./lms.ical.js";
import { notify } from "../notify/notify.service.js";
import { buildLmsNotification, hasChanges } from "./lms.notification.js";
import { runSync, type SyncReport } from "./lms.sync.js";

export interface LmsPreview {
  feedTotal: number;
  events: LmsEvent[];
  ignoredCourses: string[]; // môn có trong LMS nhưng không nằm trong config
}

/** Lấy sự kiện LMS, chỉ giữ các môn đã cấu hình trong config/courses.json */
export async function getFilteredEvents(config?: LmsConfig): Promise<LmsPreview> {
  const cfg = config ?? (await loadConfig());
  const all = await fetchIcal(env.lmsIcalUrl);
  const wanted = new Set(cfg.courses);
  const ignored = new Set<string>();
  const kept = all.filter((e) => {
    if (wanted.has(e.courseCode)) return true;
    ignored.add(e.courseCode || "(không rõ môn)");
    return false;
  });
  kept.sort((a, b) => a.end.getTime() - b.end.getTime());
  return { feedTotal: all.length, events: kept, ignoredCourses: [...ignored].sort() };
}


/** Lấy LMS, lưu vào SQLite, đối chiếu và đồng bộ với Google Calendar */
export async function syncNow(auth: OAuth2Client, dryRun = false): Promise<SyncReport> {
  const cfg = await loadConfig();
  const preview = await getFilteredEvents(cfg);
  const report = await runSync({
    db: getDb(),
    cfg,
    lmsEvents: preview.events,
    feedTotal: preview.feedTotal,
    ignoredCourses: preview.ignoredCourses,
    gateway: googleGateway(auth, await events.resolveCalendarId(auth, cfg.calendar)),
    dryRun,
  });
  // Chạy thử thì không gửi thông báo; không đổi gì thì cũng không gửi
  if (!dryRun && hasChanges(report)) {
    report.notifications = await notify(buildLmsNotification(report));
  }
  return report;
}
