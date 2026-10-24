import type {
  NotificationDetail,
  NotificationMessage,
  NotificationSection,
} from "../notify/notify.types.js";
import type { FieldChange } from "./lms.repository.js";
import type { ReportItem, SyncReport } from "./lms.sync.js";

type Changed = SyncReport["changedInLms"][number];

const hasDueChange = (c: Changed) => c.changes.some((x) => x.field === "dueAt");

/**
 * Có gì đáng báo không: sự kiện mới / đổi / bị xóa / khôi phục / lỗi.
 * Cập nhật lịch chỉ do đổi cấu hình (thời lượng, múi giờ) không phải biến động dữ liệu nên không gửi mail.
 */
export function hasChanges(r: SyncReport): boolean {
  return !!(
    r.created.length ||
    r.restored.length ||
    r.changedInLms.length ||
    r.missingInLms.length ||
    r.errors.length
  );
}

const FIELD_LABEL: Record<FieldChange["field"], string> = {
  summary: "Tiêu đề",
  description: "Mô tả",
  dueAt: "Hạn nộp",
};

const byDue = <T extends ReportItem>(a: T, b: T) =>
  a.dueAt.localeCompare(b.dueAt);
const MAX_SUBJECT = 110;
const clipTo = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/** Chuyển kết quả đồng bộ LMS thành thông điệp chung của module notify */
export function buildLmsNotification(r: SyncReport): NotificationMessage {
  const fmt = new Intl.DateTimeFormat("vi-VN", {
    timeZone: r.timeZone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const when = (iso: string) => fmt.format(new Date(iso)); // "23:00 Th 7, 31/10"
  const now = new Date(r.startedAt).getTime();

  /** "còn 2 ngày 3 giờ" / "còn 5 giờ" / "đã quá hạn" */
  const remaining = (iso: string) => {
    const mins = Math.floor((new Date(iso).getTime() - now) / 60000);
    if (mins < 0) return "đã quá hạn";
    if (mins < 60) return `còn ${mins} phút`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `còn ${hours} giờ`;
    const days = Math.floor(hours / 24);
    return `còn ${days} ngày${hours % 24 ? ` ${hours % 24} giờ` : ""}`;
  };
  const dueMeta = (iso: string) => `Hạn: ${when(iso)} · ${remaining(iso)}`;
  const label = (i: ReportItem) => `${i.courseCode} · ${i.title}`;
  const clip = (s: string) =>
    clipTo(s.replace(/\s+/g, " ").trim(), 120) || "(trống)";
  const show = (f: FieldChange["field"], v: string) =>
    f === "dueAt" ? when(v) : clip(v);

  const dueChanged = r.changedInLms.filter(hasDueChange);
  const contentChanged = r.changedInLms.filter((c) => !hasDueChange(c));
  const total =
    r.errors.length +
    r.missingInLms.length +
    r.changedInLms.length +
    r.created.length +
    r.restored.length;

  // ---- Các mục, xếp theo mức độ quan trọng: lỗi > bị xóa > thay đổi > mới > khôi phục ----
  const changeDetails = (c: Changed): NotificationDetail[] =>
    c.changes.map((x) => ({
      label: FIELD_LABEL[x.field],
      from: show(x.field, x.from),
      to: show(x.field, x.to),
    }));

  const all: NotificationSection[] = [
    {
      heading: "Lỗi đồng bộ",
      tone: "danger",
      items: [...r.errors]
        .sort(byDue)
        .map((e) => ({
          text: label(e),
          meta: dueMeta(e.dueAt),
          details: [e.error],
        })),
    },
    {
      heading: "LMS đã xóa",
      tone: "danger",
      items: [...r.missingInLms].sort(byDue).map((e) => ({
        text: label(e),
        meta: `Hạn cũ: ${when(e.dueAt)} · sự kiện vẫn còn trên Google Calendar, bạn tự xóa nếu không cần`,
      })),
    },
    {
      heading: "LMS thay đổi",
      tone: "warning",
      // đổi hạn lên trước, đổi nội dung sau
      items: [
        ...[...dueChanged].sort(byDue),
        ...[...contentChanged].sort(byDue),
      ].map((c) => ({
        text: label(c),
        meta: dueMeta(c.dueAt),
        details: changeDetails(c),
      })),
    },
    {
      heading: "Sự kiện mới",
      tone: "success",
      items: [...r.created]
        .sort(byDue)
        .map((e) => ({ text: label(e), meta: dueMeta(e.dueAt) })),
    },
    {
      heading: "Đã khôi phục trên Google Calendar",
      tone: "info",
      items: [...r.restored].sort(byDue).map((e) => ({
        text: label(e),
        meta: dueMeta(e.dueAt),
        details: ["Sự kiện bị xóa khỏi Google Calendar nên đã được tạo lại"],
      })),
    },
  ];
  const sections = all.filter((s) => s.items.length);

  // ---- Tóm tắt (dùng cho subject và nhãn đầu thư), cũng theo thứ tự quan trọng ----
  const parts = [
    r.errors.length && `${r.errors.length} lỗi`,
    r.missingInLms.length && `${r.missingInLms.length} bị xóa`,
    dueChanged.length && `${dueChanged.length} đổi hạn`,
    contentChanged.length && `${contentChanged.length} đổi nội dung`,
    r.created.length && `${r.created.length} mới`,
    r.restored.length && `${r.restored.length} khôi phục`,
  ].filter((p): p is string => !!p);

  const affected = [
    ...r.errors,
    ...r.missingInLms,
    ...r.changedInLms,
    ...r.created,
    ...r.restored,
  ];
  const courses = [...new Set(affected.map((i) => i.courseCode))].sort();

  // ---- Subject ----
  let subject: string;
  if (total === 1) {
    const only = affected[0];
    const name = `${only.courseCode} ${only.title}`;
    if (r.errors.length) subject = `Lỗi đồng bộ: ${name}`;
    else if (r.missingInLms.length)
      subject = `LMS đã xóa: ${name} (hạn ${when(only.dueAt)})`;
    else if (dueChanged.length) {
      const d = dueChanged[0].changes.find((x) => x.field === "dueAt")!;
      subject = `Đổi hạn nộp: ${name} - ${when(d.from)} → ${when(d.to)}`;
    } else if (contentChanged.length) subject = `Đổi nội dung: ${name}`;
    else if (r.created.length)
      subject = `Bài mới: ${name} - hạn ${when(only.dueAt)}`;
    else subject = `Đã khôi phục: ${name}`;
  } else {
    subject = `${parts.join(" · ")} - ${courses.join(", ")}`;
  }

  const top = sections[0]?.items[0];
  const topText =
    typeof top === "string"
      ? top
      : top
        ? `${top.text}${top.meta ? ` · ${top.meta}` : ""}`
        : "";

  return {
    subject: clipTo(`[LMS] ${subject}`, MAX_SUBJECT),
    title: "Biến động lịch học LMS",
    preheader:
      total > 1 ? `${topText} (và ${total - 1} thay đổi khác)` : topText,
    highlights: parts,
    sections,
    footer: `Môn theo dõi: ${r.courses.join(", ") || "(chưa có)"} · Cập nhật lúc ${when(r.startedAt)}`,
  };
}
