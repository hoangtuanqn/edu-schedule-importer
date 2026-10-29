import { createHash } from "node:crypto";
import { parse, type HTMLElement } from "node-html-parser";

export type SessionKind = "class" | "exam";

export interface FapSession {
  /** Id ổn định suy từ loại + môn + lớp + ngày + slot, nên đổi giờ/phòng/giảng viên vẫn là CÙNG một buổi */
  id: string;
  kind: SessionKind;
  courseCode: string; // "MAD101"
  className: string; // "AI2101"
  date: string; // YYYY-MM-DD
  slot: number;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  room: string | null;
  lecturer: string | null;
  online: boolean;
  /** Link Meet của lớp online (nút "Link Meet" trên FAP); null nếu không có */
  meetUrl: string | null;
}

export interface ParsedWeek {
  weekStart: string; // ngày của cột đầu tiên
  weekEnd: string; // ngày của cột cuối cùng
  sessions: FapSession[];
  /** Ô có lớp nhưng không đọc được (ví dụ thiếu giờ) nên bị bỏ qua */
  warnings: string[];
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const orNull = (s: string) => (s === "" || s === "-" ? null : s);

const pad = (n: number | string) => String(n).padStart(2, "0");
const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * Tiêu đề cột chỉ có "(16/11)" mà không có năm => chọn năm làm ngày đầu tuần gần `now` nhất,
 * và tăng năm khi tháng quay từ 12 về 1 giữa tuần.
 */
function resolveDates(headers: { d: number; m: number }[], now: Date): string[] {
  const nowMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const first = headers[0];
  const year = [-1, 0, 1]
    .map((o) => now.getUTCFullYear() + o)
    .sort((a, b) => Math.abs(Date.UTC(a, first.m - 1, first.d) - nowMs) - Math.abs(Date.UTC(b, first.m - 1, first.d) - nowMs))[0];

  let y = year;
  let prevMonth = first.m;
  return headers.map(({ d, m }) => {
    if (m < prevMonth) y++;
    prevMonth = m;
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) throw new Error(`Ngày không hợp lệ trong tiêu đề cột: ${d}/${m}`);
    return isoDate(y, m, d);
  });
}

const byTitle = (el: HTMLElement, title: string) => el.querySelector(`[title="${title}"]`);

/** Khối chứa thông tin một buổi: tổ tiên gần nhất của tiêu đề lớp có class "position-relative" */
function blockOf(titleEl: HTMLElement, td: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = titleEl.parentNode as HTMLElement | null;
  while (cur && cur !== td) {
    if (cur.classList?.contains("position-relative")) return cur;
    cur = cur.parentNode as HTMLElement | null;
  }
  return td;
}

/** Tuần FAP trả về có chứa ngày đã yêu cầu không? Nếu không, cách FAP chọn tuần theo referenceDate có thể đã khác dự tính. */
export const weekContains = (week: Pick<ParsedWeek, "weekStart" | "weekEnd">, date: string) =>
  date >= week.weekStart && date <= week.weekEnd;

export function parseWeeklyTimetable(html: string, now: Date = new Date()): ParsedWeek {
  const root = parse(html);
  const tables = root.querySelectorAll("table");
  const table = tables.find((t) => /slot/i.test(t.querySelector("thead")?.text ?? "")) ?? tables[0];
  if (!table) throw new Error("Không tìm thấy bảng lịch trong HTML");

  const headCells = table.querySelectorAll("thead th").slice(1); // bỏ cột "Slot"
  const headers = headCells.map((th) => {
    const m = clean(th.text).match(/\((\d{1,2})\/(\d{1,2})\)/);
    if (!m) throw new Error(`Không đọc được ngày từ tiêu đề cột "${clean(th.text)}"`);
    return { d: Number(m[1]), m: Number(m[2]) };
  });
  if (!headers.length) throw new Error("Bảng lịch không có cột ngày nào");
  const dates = resolveDates(headers, now);

  const sessions = new Map<string, FapSession>();
  const warnings: string[] = [];

  for (const row of table.querySelectorAll("tbody tr")) {
    const slot = parseInt(clean(row.querySelector("th")?.text ?? ""), 10);
    row.querySelectorAll("td").forEach((td, col) => {
      const date = dates[col];
      if (!date) return;
      for (const titleEl of td.querySelectorAll('[title="Lớp học"]')) {
        const block = blockOf(titleEl, td);
        const [courseCode, ...rest] = clean(titleEl.text).split(/\s+-\s+/);
        const className = rest.join(" - ");

        const timeText = clean(byTitle(block, "Giờ bắt đầu - Giờ kết thúc")?.text ?? "");
        const t = timeText.match(/(\d{1,2})h(\d{2})\s*-\s*(\d{1,2})h(\d{2})/);
        if (!t) {
          warnings.push(`${courseCode} ngày ${date} (slot ${slot}): không đọc được giờ học "${timeText}"`);
          continue;
        }

        const onlineText = clean(byTitle(block, "Học online")?.text ?? "");
        const href = byTitle(block, "Link Meet")?.getAttribute("href")?.trim() ?? "";
        const meetUrl = href.startsWith("http") ? href : null;
        const kind: SessionKind = /thi/i.test(clean(byTitle(block, "Loại lịch")?.text ?? "")) ? "exam" : "class";

        const id = createHash("sha1").update([kind, courseCode, className, date, slot].join("|")).digest("hex").slice(0, 24);
        if (sessions.has(id)) continue;
        sessions.set(id, {
          id,
          kind,
          courseCode: courseCode.toUpperCase(),
          className,
          date,
          slot,
          startTime: `${pad(t[1])}:${t[2]}`,
          endTime: `${pad(t[3])}:${t[4]}`,
          room: orNull(clean(byTitle(block, "Phòng")?.text ?? "")),
          lecturer: orNull(clean(byTitle(block, "Giảng viên")?.text ?? "")),
          online: /online/i.test(onlineText) && !/offline/i.test(onlineText),
          meetUrl,
        });
      }
    });
  }

  return { weekStart: dates[0], weekEnd: dates[dates.length - 1], sessions: [...sessions.values()], warnings };
}
