import type { StoredSession } from "./fap.repository.js";
import type { FapReport } from "./fap.sync.js";
import { whenLabel } from "./fap.time.js";

const line = (s: StoredSession) =>
  `    - ${whenLabel(s.date, s.startTime)}-${s.endTime}  ${s.kind === "exam" ? "[THI] " : ""}${s.courseCode}-${s.className}` +
  `  ${s.online ? "Online" : s.room ?? "chưa có phòng"}${s.lecturer ? `  GV: ${s.lecturer}` : ""}`;

export function formatFapReport(r: FapReport): string {
  const MAX = 30; // lần nhập đầu cho 4 tháng có thể có hàng trăm buổi
  const section = (title: string, items: StoredSession[]) =>
    items.length
      ? [`  ${title} (${items.length}):`, ...items.slice(0, MAX).map(line), ...(items.length > MAX ? [`    … và ${items.length - MAX} buổi khác`] : [])]
      : [];
  const verb = r.dryRun ? "SẼ " : "";

  const out: string[] = ["=".repeat(60), `BÁO CÁO LỊCH HỌC / LỊCH THI (FAP)${r.dryRun ? "  [CHẠY THỬ - không ghi gì]" : ""}`, "=".repeat(60)];
  out.push(`  Môn               : tất cả môn trong lịch FAP${r.excludedCourses.length ? ` (loại trừ: ${r.excludedCourses.join(", ")})` : ""}`);
  if (r.range) {
    out.push(`  Đã nhập           : ${r.range.weeks} tuần (${r.range.start} → ${r.range.end}), đọc được ${r.parsedTotal} buổi, ${r.newlyStored} buổi mới được lưu vào DB`);
  }
  out.push("");
  out.push(...section(`${verb}THÊM MỚI`, r.created));
  out.push(...section(`${verb}CẬP NHẬT`, r.updated));
  out.push(...section(`${verb}KHÔI PHỤC (đã bị xóa trên Google Calendar)`, r.restored));
  if (r.changed.length) {
    out.push(`  FAP ĐÃ THAY ĐỔI (${r.changed.length}):`);
    for (const c of r.changed) out.push(line(c), ...c.changes.map((x) => `        ${x.field}: ${x.from} → ${x.to}`));
  }
  out.push(...section("KHÔNG CÒN TRÊN FAP (không động tới Google)", r.missing));
  if (r.errors.length) {
    out.push(`  LỖI (${r.errors.length}):`);
    for (const e of r.errors) out.push(line(e), `        → ${e.error}`);
  }
  for (const w of r.warnings) out.push(`  Cảnh báo: ${w}`);

  if (!r.created.length && !r.updated.length && !r.restored.length && !r.errors.length) out.push("  Không có gì thay đổi, lịch đã khớp với FAP.");
  out.push("");
  out.push(
    `  Tổng: ${r.created.length} mới, ${r.updated.length} cập nhật, ${r.restored.length} khôi phục, ` +
      `${r.unchanged} không đổi, ${r.errors.length} lỗi  (${(r.durationMs / 1000).toFixed(1)}s)`,
  );
  if (r.ignoredCourses.length) out.push(`  Môn bị bỏ qua theo cấu hình fap.ignoreCourses: ${r.ignoredCourses.join(", ")}`);
  if (r.notifications) {
    if (!r.notifications.length) out.push("  Thông báo: chưa bật kênh nào (điền SMTP_USER, SMTP_PASS trong .env để gửi email)");
    for (const n of r.notifications) out.push(`  Thông báo qua ${n.channel}: ${n.ok ? "đã gửi" : `GỬI THẤT BẠI → ${n.error}`}`);
  }
  out.push("=".repeat(60));
  return out.join("\n");
}
