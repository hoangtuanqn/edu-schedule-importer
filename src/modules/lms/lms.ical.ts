import { HttpError } from "../../middlewares/httpError.js";

export interface LmsEvent {
  uid: string; // ví dụ "3831" (bỏ phần @domain)
  summary: string;
  description: string;
  courseCode: string; // "CSI106" (rút từ CATEGORIES "CSI106-DucDNM")
  courseLabel: string; // nguyên văn CATEGORIES
  start: Date;
  end: Date;
  allDay: boolean;
}

function decodeEntities(s: string): string {
  let prev = "";
  // LMS có lúc mã hóa HTML 2 lần (&amp;amp;) nên lặp tới khi ổn định
  for (let i = 0; i < 3 && s !== prev; i++) {
    prev = s;
    s = s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");
  }
  return s;
}

function unescapeText(s: string): string {
  return decodeEntities(
    s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1"),
  ).trim();
}

function parseDate(value: string): { date: Date; allDay: boolean } {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
  if (!m) throw new Error(`Định dạng ngày không hỗ trợ: ${value}`);
  const [, y, mo, d, h, mi, s] = m;
  if (h === undefined) return { date: new Date(Date.UTC(+y, +mo - 1, +d)), allDay: true };
  return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false };
}

export function parseIcal(text: string): LmsEvent[] {
  const lines = text.replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events: LmsEvent[] = [];
  let cur: Record<string, string> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT" && cur) {
      if (cur.UID && cur.DTSTART) {
        const start = parseDate(cur.DTSTART);
        const end = cur.DTEND ? parseDate(cur.DTEND) : start;
        const label = unescapeText(cur.CATEGORIES ?? "");
        events.push({
          uid: cur.UID.split("@")[0],
          summary: unescapeText(cur.SUMMARY ?? "(không tiêu đề)"),
          description: unescapeText(cur.DESCRIPTION ?? ""),
          courseLabel: label,
          courseCode: (label.match(/^([A-Za-z0-9]+)/)?.[1] ?? "").toUpperCase(),
          start: start.date,
          end: end.date,
          allDay: start.allDay,
        });
      }
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(":");
      if (idx > 0) cur[line.slice(0, idx).split(";")[0].toUpperCase()] = line.slice(idx + 1);
    }
  }
  return events;
}

export async function fetchIcal(url: string | undefined): Promise<LmsEvent[]> {
  if (!url) throw new HttpError(500, "Thiếu LMS_ICAL_URL trong file .env");
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new HttpError(502, `LMS trả về HTTP ${res.status} khi tải lịch iCal`);
  const body = await res.text();
  if (!body.includes("BEGIN:VCALENDAR")) {
    throw new HttpError(502, "LMS không trả về iCal hợp lệ (URL có thể đã bị reset hoặc bị chặn)");
  }
  return parseIcal(body);
}
