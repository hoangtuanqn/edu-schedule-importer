import type { NotificationItem, NotificationMessage, NotificationSection } from "../notify/notify.types.js";
import type { FapChange, StoredSession } from "./fap.repository.js";
import type { FapReport } from "./fap.sync.js";
import { whenLabel } from "./fap.time.js";

type Changed = FapReport["changed"][number];

/** Có gì đáng báo: buổi mới / đổi / bị hủy / khôi phục / lỗi. Cập nhật lịch thuần do đổi cấu hình thì không. */
export function hasFapChanges(r: FapReport): boolean {
  return !!(r.created.length || r.changed.length || r.missing.length || r.restored.length || r.errors.length);
}

const FIELD_LABEL: Record<FapChange["field"], string> = {
  time: "Giờ",
  room: "Phòng",
  lecturer: "Giảng viên",
  online: "Hình thức",
  meet: "Link Meet",
};

const byWhen = (a: StoredSession, b: StoredSession) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`);
const clipTo = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const name = (s: StoredSession) => `${s.kind === "exam" ? "[Thi] " : ""}${s.courseCode}${s.className ? ` - ${s.className}` : ""}`;
const where = (s: StoredSession) => (s.online ? "Online" : s.room ? `Phòng ${s.room.replace(/^P\.?\s*/i, "")}` : "chưa có phòng");
const meta = (s: StoredSession) =>
  `${whenLabel(s.date, s.startTime)}–${s.endTime} · ${where(s)}${s.lecturer ? ` · GV: ${s.lecturer}` : ""}`;

const item = (s: StoredSession): NotificationItem => ({ text: name(s), meta: meta(s) });

/** Lần nhập đầu cho cả 4 tháng có thể có hàng trăm buổi: chỉ liệt kê MAX_ITEMS dòng đầu, phần còn lại ghi gọn */
export const MAX_ITEMS = 25;
function section(heading: string, tone: NotificationSection["tone"], items: NotificationItem[]): NotificationSection {
  if (items.length <= MAX_ITEMS) return { heading, tone, items };
  const rest = items.length - MAX_ITEMS;
  return { heading, tone, items: [...items.slice(0, MAX_ITEMS), `… và ${rest} mục khác`], total: items.length };
}

export function buildFapNotification(r: FapReport): NotificationMessage {
  // Buổi mới thì không cần liệt kê thêm là "thay đổi"
  const createdIds = new Set(r.created.map((s) => s.id));
  const changed: Changed[] = r.changed.filter((c) => !createdIds.has(c.id));

  const exams = (list: StoredSession[]) => list.filter((s) => s.kind === "exam").sort(byWhen);
  const classes = (list: StoredSession[]) => list.filter((s) => s.kind !== "exam").sort(byWhen);

  const change = (c: Changed): NotificationItem => ({
    text: name(c),
    meta: meta(c),
    details: c.changes.map((x) => ({ label: FIELD_LABEL[x.field], from: x.from, to: x.to })),
  });

  const all: NotificationSection[] = [
    section("Lỗi đồng bộ", "danger", [...r.errors].sort(byWhen).map((e) => ({ text: name(e), meta: meta(e), details: [e.error] }))),
    section("Lịch thi mới", "danger", exams(r.created).map(item)),
    section(
      "Lịch bị hủy hoặc dời (không còn trên FAP)",
      "danger",
      [...r.missing].sort(byWhen).map((s) => ({
        text: name(s),
        meta: `${meta(s)} · sự kiện vẫn còn trên Google Calendar, bạn tự xóa nếu không cần`,
      })),
    ),
    section(
      "Thay đổi",
      "warning",
      [...changed].sort((a, b) => Number(b.kind === "exam") - Number(a.kind === "exam") || byWhen(a, b)).map(change),
    ),
    section("Lịch học mới", "success", classes(r.created).map(item)),
    section(
      "Đã khôi phục trên Google Calendar",
      "info",
      [...r.restored].sort(byWhen).map((s) => ({
        text: name(s),
        meta: meta(s),
        details: ["Sự kiện bị xóa khỏi Google Calendar nên đã được tạo lại"],
      })),
    ),
  ];
  const sections = all.filter((s) => s.items.length);

  const examNew = exams(r.created).length;
  const classNew = classes(r.created).length;
  const parts = [
    r.errors.length && `${r.errors.length} lỗi`,
    examNew && `${examNew} lịch thi mới`,
    r.missing.length && `${r.missing.length} bị hủy`,
    changed.length && `${changed.length} thay đổi`,
    classNew && `${classNew} lịch học mới`,
    r.restored.length && `${r.restored.length} khôi phục`,
  ].filter((p): p is string => !!p);

  const affected = [...r.errors, ...r.created, ...r.missing, ...changed, ...r.restored];
  const courses = [...new Set(affected.map((s) => s.courseCode))].sort();
  const total = r.errors.length + r.created.length + r.missing.length + changed.length + r.restored.length;

  let subject: string;
  if (total === 1) {
    const s = affected[0];
    const lead = r.errors.length ? "Lỗi đồng bộ"
      : r.created.length ? (s.kind === "exam" ? "Lịch thi mới" : "Lịch học mới")
      : r.missing.length ? "Lịch bị hủy/dời"
      : changed.length ? (s.kind === "exam" ? "Đổi lịch thi" : "Đổi lịch học")
      : "Đã khôi phục";
    const delta = changed.length ? ` (${changed[0].changes.map((c) => `${FIELD_LABEL[c.field].toLowerCase()}: ${c.from} → ${c.to}`).join("; ")})` : "";
    subject = `${lead}: ${name(s)} - ${whenLabel(s.date, s.startTime)} · ${where(s)}${delta}`;
  } else {
    subject = `${parts.join(" · ")} - ${courses.join(", ")}`;
  }

  const top = sections[0]?.items[0];
  const topText = typeof top === "string" ? top : top ? `${top.text}${top.meta ? ` · ${top.meta}` : ""}` : "";

  return {
    subject: clipTo(`[FAP] ${subject}`, 120),
    title: "Biến động lịch học / lịch thi (FAP)",
    preheader: total > 1 ? `${topText} (và ${total - 1} thay đổi khác)` : topText,
    highlights: parts,
    sections,
    footer: `Lấy tất cả môn trong lịch FAP${r.ignoredCourses.length ? ` · Bỏ qua theo cấu hình fap.ignoreCourses: ${r.ignoredCourses.join(", ")}` : ""}${r.range ? ` · Đã quét ${r.range.weeks} tuần (${r.range.start} → ${r.range.end})` : ""}`,
  };
}
