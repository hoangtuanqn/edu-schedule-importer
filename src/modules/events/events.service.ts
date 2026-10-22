import { google, type calendar_v3 } from "googleapis";
import type { OAuth2Client } from "../../config/google.js";
import type { CreateEventDto, UpdateEventDto } from "./events.schema.js";

const CALENDAR_ID = "primary";

const calendar = (auth: OAuth2Client) => google.calendar({ version: "v3", auth });

export interface ListParams {
  maxResults?: number;
  timeMin?: string;
  timeMax?: string;
  q?: string;
}

export async function list(auth: OAuth2Client, p: ListParams) {
  const res = await calendar(auth).events.list({
    calendarId: CALENDAR_ID,
    timeMin: p.timeMin ?? new Date().toISOString(),
    timeMax: p.timeMax,
    q: p.q,
    maxResults: p.maxResults ?? 10,
    singleEvents: true,
    orderBy: "startTime",
  });
  return res.data.items ?? [];
}

export async function get(auth: OAuth2Client, eventId: string) {
  return (await calendar(auth).events.get({ calendarId: CALENDAR_ID, eventId })).data;
}

export async function create(auth: OAuth2Client, dto: CreateEventDto) {
  return (await calendar(auth).events.insert({ calendarId: CALENDAR_ID, requestBody: dto })).data;
}

export async function update(auth: OAuth2Client, eventId: string, dto: UpdateEventDto) {
  return (await calendar(auth).events.patch({ calendarId: CALENDAR_ID, eventId, requestBody: dto })).data;
}

/** "deleted" = đã xóa (Google giữ bản ghi cancelled), "missing" = không tồn tại */
export async function getStatus(
  auth: OAuth2Client,
  eventId: string,
  calendarId = CALENDAR_ID,
): Promise<"exists" | "deleted" | "missing"> {
  try {
    const res = await calendar(auth).events.get({ calendarId, eventId });
    return res.data.status === "cancelled" ? "deleted" : "exists";
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code === 404) return "missing";
    if (code === 410) return "deleted";
    throw e;
  }
}

export type EventsApi = Pick<calendar_v3.Resource$Events, "insert" | "get" | "patch">;

const codeOf = (e: unknown) => (e as { code?: number }).code;
const MAX_ID_ATTEMPTS = 10;

/** "lms13664" -> "lms13664r1" -> "lms13664r2"... (r nằm trong bảng ký tự id hợp lệ của Google: a-v, 0-9) */
export function nextEventId(eventId: string, step: number): string {
  const base = eventId.replace(/r\d+$/, "");
  const n = Number(eventId.match(/r(\d+)$/)?.[1] ?? 0);
  return `${base}r${n + step}`;
}

/**
 * Tạo hoặc cập nhật sự kiện theo id cố định, chạy lại không bị trùng. Trả về id THỰC SỰ được dùng.
 *
 * Khi người dùng xóa sự kiện, Google giữ một bản "cancelled" mang đúng id đó và KHÔNG cho khôi phục
 * qua API (insert -> 409, patch/update -> 403). Vì vậy gặp bản đã xóa thì tạo lại bằng id kế tiếp.
 */
export async function upsertVia(
  api: EventsApi,
  eventId: string,
  body: calendar_v3.Schema$Event,
  calendarId = CALENDAR_ID,
) {
  // colorId = null chỉ có nghĩa khi patch (xóa màu); khi tạo mới thì bỏ đi
  const { colorId, ...rest } = body;
  for (let step = 0; step < MAX_ID_ATTEMPTS; step++) {
    const id = step === 0 ? eventId : nextEventId(eventId, step);
    try {
      const res = await api.insert({
        calendarId,
        requestBody: { ...rest, ...(colorId ? { colorId } : {}), id },
      });
      return { action: "created" as const, event: res.data, eventId: id };
    } catch (e) {
      if (codeOf(e) !== 409) throw e;
      const existing = (await api.get({ calendarId, eventId: id })).data;
      if (existing.status !== "cancelled") {
        const res = await api.patch({ calendarId, eventId: id, requestBody: { ...body, status: "confirmed" } });
        return { action: "updated" as const, event: res.data, eventId: id };
      }
      // id này đang là bản đã xóa => thử id kế tiếp
    }
  }
  throw Object.assign(new Error(`Không tạo được sự kiện ${eventId}: ${MAX_ID_ATTEMPTS} id liên tiếp đều là bản đã xóa`), {
    code: 500,
  });
}

export const upsert = (auth: OAuth2Client, eventId: string, body: calendar_v3.Schema$Event, calendarId = CALENDAR_ID) =>
  upsertVia(calendar(auth).events, eventId, body, calendarId);

/** Chuyển sự kiện sang lịch khác, giữ nguyên id và nội dung */
export async function move(auth: OAuth2Client, eventId: string, fromCalendarId: string, toCalendarId: string) {
  await calendar(auth).events.move({ calendarId: fromCalendarId, eventId, destination: toCalendarId });
}

/**
 * Tìm id lịch từ giá trị người dùng ghi trong config: id, "primary", hoặc tên lịch
 * (khớp chính xác, rồi đến khớp một phần, không phân biệt hoa thường, nên "Nhắc nhở" khớp "❗ Nhắc nhở").
 * Chỉ xét lịch có quyền ghi.
 */
export async function resolveCalendarId(auth: OAuth2Client, nameOrId: string): Promise<string> {
  if (nameOrId === "primary") return "primary";
  const items = (await calendar(auth).calendarList.list()).data.items ?? [];
  const writable = items.filter((c) => c.accessRole === "owner" || c.accessRole === "writer");
  const q = nameOrId.trim().toLowerCase();

  const byId = writable.find((c) => c.id === nameOrId);
  if (byId) return byId.id!;
  const exact = writable.filter((c) => c.summary?.trim().toLowerCase() === q);
  const matches = exact.length ? exact : writable.filter((c) => c.summary?.toLowerCase().includes(q));
  if (matches.length === 1) return matches[0].id!;

  const names = writable.map((c) => `"${c.summary}"`).join(", ");
  throw Object.assign(
    new Error(
      matches.length
        ? `Có ${matches.length} lịch khớp "${nameOrId}" (${matches.map((c) => c.summary).join(", ")}), hãy ghi tên đầy đủ hơn trong config/courses.json`
        : `Không tìm thấy lịch "${nameOrId}" trong tài khoản. Các lịch có thể ghi: ${names}`,
    ),
    { code: 400 },
  );
}

export async function remove(auth: OAuth2Client, eventId: string) {
  await calendar(auth).events.delete({ calendarId: CALENDAR_ID, eventId });
}
