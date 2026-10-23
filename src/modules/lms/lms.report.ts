import type { ReportItem, SyncReport } from "./lms.sync.js";

export function formatReport(r: SyncReport): string {
  const fmt = new Intl.DateTimeFormat("vi-VN", {
    timeZone: r.timeZone,
    dateStyle: "short",
    timeStyle: "short",
  });
  const line = (i: ReportItem) => `    - ${fmt.format(new Date(i.dueAt))}  ${i.summary}`;
  const section = (title: string, items: ReportItem[]) =>
    items.length ? [`  ${title} (${items.length}):`, ...items.map(line)] : [];

  const out: string[] = [];
  out.push("=".repeat(60));
  out.push(`BÁO CÁO ĐỒNG BỘ LMS → GOOGLE CALENDAR${r.dryRun ? "  [CHẠY THỬ - không ghi gì]" : ""}`);
  out.push("=".repeat(60));
  out.push(`  Môn đang theo dõi : ${r.courses.join(", ") || "(chưa cấu hình môn nào)"}`);
  out.push(`  LMS trả về        : ${r.feedTotal} sự kiện (${r.newlyStored} sự kiện mới được lưu vào DB)`);
  out.push("");

  const verb = r.dryRun ? "SẼ " : "";
  out.push(...section(`${verb}THÊM MỚI`, r.created));
  out.push(...section(`${verb}CẬP NHẬT (LMS hoặc cấu hình đổi)`, r.updated));
  out.push(...section(`${verb}KHÔI PHỤC (đã bị xóa trên Google Calendar)`, r.restored));
  out.push(...section(`${verb}CHUYỂN SANG LỊCH MỚI`, r.moved));
  out.push(...section("LMS ĐÃ THAY ĐỔI SỰ KIỆN", r.changedInLms));
  out.push(...section("LMS ĐÃ XÓA SỰ KIỆN NÀY (không động tới Google)", r.missingInLms));
  if (r.errors.length) {
    out.push(`  LỖI (${r.errors.length}):`);
    for (const e of r.errors) out.push(`${line(e)}\n        → ${e.error}`);
  }

  const changed = r.created.length + r.updated.length + r.restored.length + r.moved.length;
  if (!changed && !r.errors.length) out.push("  Không có gì thay đổi, lịch đã khớp với LMS.");
  out.push("");
  out.push(
    `  Tổng: ${r.created.length} mới, ${r.updated.length} cập nhật, ${r.restored.length} khôi phục, ${r.moved.length} chuyển lịch, ` +
      `${r.unchanged} không đổi, ${r.errors.length} lỗi  (${(r.durationMs / 1000).toFixed(1)}s)`,
  );
  if (r.notifications) {
    if (!r.notifications.length) out.push("  Thông báo: chưa bật kênh nào (điền SMTP_USER, SMTP_PASS trong .env để gửi email)");
    for (const n of r.notifications) {
      out.push(`  Thông báo qua ${n.channel}: ${n.ok ? "đã gửi" : `GỬI THẤT BẠI → ${n.error}`}`);
    }
  }
  if (r.ignoredCourses.length) {
    out.push(`  Môn có trên LMS nhưng không theo dõi: ${r.ignoredCourses.join(", ")}`);
  }
  out.push("=".repeat(60));
  return out.join("\n");
}
