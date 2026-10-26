import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { calendar_v3 } from "googleapis";
import { openDb, type Db } from "../../db/database.js";
import type { LmsConfig } from "./lms.config.js";
import type { LmsEvent } from "./lms.ical.js";
import { nextEventId, upsertVia, type EventsApi } from "../events/events.service.js";
import { runSync, type CalendarGateway } from "./lms.sync.js";

const DAY = 24 * 3600 * 1000;
const T0 = new Date("2026-11-01T03:00:00Z");
const cfg: LmsConfig = {
  courses: ["PRO192"], eventDurationMinutes: 30, timeZone: "Asia/Ho_Chi_Minh",
  calendar: "Nhắc nhở", eventColor: "tomato", reminderMinutes: [10080, 4320, 1440, 300],
};

const ev = (uid: string, due: Date, over: Partial<LmsEvent> = {}): LmsEvent => ({
  uid, summary: `Bài ${uid}`, description: "", courseCode: "PRO192", courseLabel: "PRO192-X",
  start: due, end: due, allDay: false, ...over,
});

/**
 * Google giả, mô phỏng đúng hành vi thật: xóa sự kiện chỉ để lại bản "cancelled" mang cùng id,
 * và bản đó KHÔNG khôi phục được (insert -> 409, patch -> 403).
 */
type Store = Map<string, calendar_v3.Schema$Event>;
const err = (code: number) => Object.assign(new Error(`HTTP ${code}`), { code });

function fakeEventsApi(store: Store, dead: Set<string>, cal: string): EventsApi {
  const key = (id: string) => `${cal}|${id}`;
  return {
    insert: async ({ requestBody }: any) => {
      const id = requestBody.id as string;
      if (store.has(id) || dead.has(key(id))) throw err(409);
      store.set(id, requestBody);
      return { data: requestBody };
    },
    get: async ({ eventId }: any) => {
      if (dead.has(key(eventId))) return { data: { status: "cancelled" } };
      if (store.has(eventId)) return { data: { ...store.get(eventId), status: "confirmed" } };
      throw err(404);
    },
    patch: async ({ eventId, requestBody }: any) => {
      if (dead.has(key(eventId))) throw err(403);
      store.set(eventId, { ...store.get(eventId), ...requestBody });
      return { data: store.get(eventId) };
    },
  } as unknown as EventsApi;
}

function fakeGoogle(
  calendars: Record<string, Store> = { primary: new Map(), reminders: new Map() },
  target = "reminders",
  dead = new Set<string>(),
) {
  const store = calendars[target]; // lịch đích
  const calls = { upsert: 0, status: 0, move: 0 };
  const api = fakeEventsApi(store, dead, target);
  const gateway: CalendarGateway = {
    calendarId: target,
    async status(id, inCal = target) { calls.status++; return calendars[inCal].has(id) ? "exists" : "deleted"; },
    async upsert(id, body) { calls.upsert++; return (await upsertVia(api, id, body, target)).eventId; },
    async move(id, from) { calls.move++; store.set(id, calendars[from].get(id)!); calendars[from].delete(id); },
  };
  /** Người dùng xóa mọi sự kiện trong lịch đích trên Google (để lại bản cancelled) */
  const wipe = () => { for (const id of store.keys()) dead.add(`${target}|${id}`); store.clear(); };
  return { store, calendars, calls, gateway, wipe, dead };
}

describe("runSync", () => {
  let db: Db;
  beforeEach(() => { db = openDb(":memory:"); });

  const run = (g: ReturnType<typeof fakeGoogle>, lms: LmsEvent[], now = T0, c = cfg) =>
    runSync({ db, cfg: c, lmsEvents: lms, feedTotal: lms.length, ignoredCourses: [], gateway: g.gateway, now });

  it("tạo mới, rồi chạy lại thì không đổi gì", async () => {
    const g = fakeGoogle();
    const feed = [ev("1", new Date(+T0 + 3 * DAY)), ev("2", new Date(+T0 - 2 * DAY))];

    const r1 = await run(g, feed);
    assert.equal(r1.created.length, 2);
    assert.equal(r1.newlyStored, 2);

    const r2 = await run(g, feed);
    assert.equal(r2.created.length + r2.updated.length + r2.restored.length, 0);
    assert.equal(r2.unchanged, 2);
    assert.equal(r2.newlyStored, 0);
  });

  it("sự kiện hạn trong tương lai bị xóa trên Google thì được khôi phục", async () => {
    const g = fakeGoogle();
    const feed = [ev("1", new Date(+T0 + 3 * DAY))];
    await run(g, feed);
    g.wipe(); // người dùng xóa trên Google

    const r = await run(g, feed);
    assert.equal(r.restored.length, 1);
    assert.equal(g.store.size, 1);
  });

  it("sự kiện đã rời khỏi feed LMS (quá 5 ngày) vẫn khôi phục được nếu hạn trong 10 ngày", async () => {
    const g = fakeGoogle();
    await run(g, [ev("1", new Date(+T0 - 2 * DAY))]);
    g.wipe();

    // 6 ngày sau: hạn đã cách 8 ngày, LMS không còn trả về nữa
    const r = await run(g, [], new Date(+T0 + 6 * DAY));
    assert.equal(r.restored.length, 1);
    assert.equal(r.missingInLms.length, 0);
  });

  it("sự kiện quá 10 ngày thì không khôi phục", async () => {
    const g = fakeGoogle();
    await run(g, [ev("1", new Date(+T0 - 2 * DAY))]);
    g.wipe();

    // 9 ngày sau: hạn đã cách 11 ngày
    const r = await run(g, [], new Date(+T0 + 9 * DAY));
    assert.equal(r.restored.length, 0);
    assert.equal(g.store.size, 0);
  });

  it("LMS xóa sự kiện còn trong cửa sổ => báo missing và không đụng Google", async () => {
    const g = fakeGoogle();
    await run(g, [ev("1", new Date(+T0 + 3 * DAY))]);
    const before = g.calls.upsert;
    g.wipe();

    const r = await run(g, []);
    assert.equal(r.missingInLms.length, 1);
    assert.equal(r.restored.length, 0);
    assert.equal(g.calls.upsert, before);
  });

  it("đổi thời lượng trong config thì cập nhật lại", async () => {
    const g = fakeGoogle();
    const feed = [ev("1", new Date(+T0 + 3 * DAY))];
    await run(g, feed);

    const r = await run(g, feed, T0, { ...cfg, eventDurationMinutes: 60 });
    assert.equal(r.updated.length, 1);
  });

  it("LMS đổi hạn nộp / tiêu đề => ghi lại giá trị trước và sau, và cập nhật Google", async () => {
    const g = fakeGoogle();
    await run(g, [ev("1", new Date(+T0 + 3 * DAY))]);

    const newDue = new Date(+T0 + 4 * DAY);
    const r = await run(g, [ev("1", newDue, { summary: "Bài 1 (đổi tên)" })]);
    assert.equal(r.changedInLms.length, 1);
    assert.deepEqual(r.changedInLms[0].changes.map((c) => c.field), ["summary", "dueAt"]);
    assert.equal(r.changedInLms[0].changes[1].to, newDue.toISOString());
    assert.equal(r.updated.length, 1);
  });

  it("tiêu đề sạch, gắn màu, và đặt lời nhắc popup tính từ hạn nộp", async () => {
    const g = fakeGoogle();
    const due = new Date(+T0 + 10 * DAY);
    await run(g, [ev("1", due)]);
    const body = [...g.store.values()][0];

    assert.equal(body.summary, "[PRO192] Bài 1"); // không có tiền tố nhãn
    assert.equal(body.colorId, "11"); // tomato
    assert.equal(body.reminders?.useDefault, false);
    // Google tính lời nhắc từ lúc BẮT ĐẦU sự kiện (sớm hơn hạn 30 phút) => mỗi mốc trừ 30 phút
    assert.deepEqual(
      body.reminders?.overrides?.map((o) => [o.method, o.minutes]),
      [["popup", 10050], ["popup", 4290], ["popup", 1410], ["popup", 270]],
    );
    // Kiểm tra theo giờ thật: mỗi lời nhắc phải rơi đúng 1 tuần / 3 ngày / 1 ngày / 5 giờ trước HẠN NỘP
    const start = new Date(body.start!.dateTime!).getTime();
    const beforeDue = body.reminders!.overrides!.map((o) => (+due - (start - o.minutes! * 60000)) / 60000);
    assert.deepEqual(beforeDue, [10080, 4320, 1440, 300]);
  });

  it("mốc nhắc gần hạn hơn thời lượng sự kiện thì nhắc ngay lúc bắt đầu, không bị âm", async () => {
    const g = fakeGoogle();
    await run(g, [ev("1", new Date(+T0 + DAY))], T0, { ...cfg, reminderMinutes: [10, 5] });
    assert.deepEqual([...g.store.values()][0].reminders?.overrides?.map((o) => o.minutes), [0]);
  });

  it("đổi màu hoặc mốc nhắc trong config thì cập nhật lại sự kiện", async () => {
    const g = fakeGoogle();
    const feed = [ev("1", new Date(+T0 + 3 * DAY))];
    await run(g, feed);

    const r1 = await run(g, feed, T0, { ...cfg, eventColor: "peacock" });
    assert.equal(r1.updated.length, 1);
    assert.equal([...g.store.values()][0].colorId, "7");

    const r2 = await run(g, feed, T0, { ...cfg, eventColor: "peacock", reminderMinutes: [60] });
    assert.equal(r2.updated.length, 1);
    assert.deepEqual([...g.store.values()][0].reminders?.overrides?.map((o) => o.minutes), [30]);
  });

  it("sự kiện đã tạo ở lịch chính (bản cũ) thì chuyển sang lịch đích, không tạo trùng", async () => {
    const calendars = { primary: new Map(), reminders: new Map() } as Record<string, Store>;
    const feed = [ev("1", new Date(+T0 + 3 * DAY))];

    // phiên bản cũ: đồng bộ vào lịch chính
    await run(fakeGoogle(calendars, "primary"), feed);
    assert.equal(calendars.primary.size, 1);

    // phiên bản mới: lịch đích là "reminders"
    const g = fakeGoogle(calendars, "reminders");
    const r = await run(g, feed);
    assert.equal(r.moved.length, 1);
    assert.equal(r.created.length + r.restored.length, 0);
    assert.equal(calendars.primary.size, 0);
    assert.equal(calendars.reminders.size, 1);

    // lần sau không chuyển nữa
    const r2 = await run(g, feed);
    assert.equal(r2.moved.length, 0);
    assert.equal(g.calls.move, 1);
  });

  it("bị xóa khỏi lịch cũ trước khi chuyển => khôi phục vào lịch đích", async () => {
    const calendars = { primary: new Map(), reminders: new Map() } as Record<string, Store>;
    const feed = [ev("1", new Date(+T0 + 3 * DAY))];
    await run(fakeGoogle(calendars, "primary"), feed);
    calendars.primary.clear(); // người dùng xóa

    const r = await run(fakeGoogle(calendars, "reminders"), feed);
    assert.equal(r.restored.length, 1);
    assert.equal(r.moved.length, 0);
    assert.equal(calendars.reminders.size, 1);
  });

  it("chạy thử (dryRun) báo sẽ chuyển nhưng không động tới Google", async () => {
    const calendars = { primary: new Map(), reminders: new Map() } as Record<string, Store>;
    const feed = [ev("1", new Date(+T0 + 3 * DAY))];
    await run(fakeGoogle(calendars, "primary"), feed);

    const g = fakeGoogle(calendars, "reminders");
    const r = await runSync({ db, cfg, lmsEvents: feed, feedTotal: 1, ignoredCourses: [], gateway: g.gateway, dryRun: true, now: T0 });
    assert.equal(r.moved.length, 1);
    assert.equal(r.restored.length, 0); // không được báo nhầm là khôi phục
    assert.equal(g.calls.move, 0);
    assert.equal(calendars.primary.size, 1);
  });

  it("eventColor rỗng => colorId null (xóa màu riêng khi cập nhật), tạo mới thì không gửi màu", async () => {
    const g = fakeGoogle();
    const feed = [ev("1", new Date(+T0 + 3 * DAY))];
    await run(g, feed);
    assert.equal([...g.store.values()][0].colorId, "11");
    const r = await run(g, feed, T0, { ...cfg, eventColor: "" });
    assert.equal(r.updated.length, 1);
    assert.equal([...g.store.values()][0].colorId, null);
  });

  it("xóa thật trên Google (còn bản cancelled) => khôi phục bằng id mới và nhớ id đó", async () => {
    const g = fakeGoogle();
    const feed = [ev("1", new Date(+T0 + 3 * DAY))];
    await run(g, feed);
    assert.ok(g.store.has("lms1"));

    g.wipe();
    const r1 = await run(g, feed);
    assert.equal(r1.restored.length, 1);
    assert.equal(r1.errors.length, 0);
    assert.deepEqual([...g.store.keys()], ["lms1r1"]);

    // lần sau coi là đã khớp, không tạo thêm
    const upserts = g.calls.upsert;
    const r2 = await run(g, feed);
    assert.equal(r2.unchanged, 1);
    assert.equal(g.calls.upsert, upserts);

    // xóa lần nữa => id kế tiếp
    g.wipe();
    const r3 = await run(g, feed);
    assert.equal(r3.restored.length, 1);
    assert.deepEqual([...g.store.keys()], ["lms1r2"]);
  });

  it("sự kiện chưa đồng bộ nhưng id đã là bản đã xóa vẫn tạo được, không lỗi", async () => {
    const g = fakeGoogle();
    g.dead.add("reminders|lms1");
    const r = await run(g, [ev("1", new Date(+T0 + DAY))]);
    assert.equal(r.errors.length, 0);
    assert.equal(r.created.length, 1);
    assert.deepEqual([...g.store.keys()], ["lms1r1"]);
  });

  it("chỉ xét các môn trong config", async () => {
    const g = fakeGoogle();
    await run(g, [ev("1", new Date(+T0 + DAY))]);
    const r = await run(g, [], T0, { ...cfg, courses: ["MAD101"] });
    assert.equal(r.created.length + r.restored.length + r.unchanged, 0);
  });

  it("dryRun không ghi lên Google và không đánh dấu đã đồng bộ", async () => {
    const g = fakeGoogle();
    const feed = [ev("1", new Date(+T0 + DAY))];
    const r = await runSync({ db, cfg, lmsEvents: feed, feedTotal: 1, ignoredCourses: [], gateway: g.gateway, dryRun: true, now: T0 });
    assert.equal(r.created.length, 1);
    assert.equal(g.calls.upsert, 0);
    assert.equal((await run(g, feed)).created.length, 1); // chạy thật sau đó vẫn là "tạo mới"
  });

  it("một sự kiện lỗi không làm hỏng các sự kiện còn lại", async () => {
    const g = fakeGoogle();
    const orig = g.gateway.upsert;
    g.gateway.upsert = async (id, body) => {
      if (id === "lms1") throw new Error("boom");
      return orig(id, body);
    };
    const r = await run(g, [ev("1", new Date(+T0 + DAY)), ev("2", new Date(+T0 + 2 * DAY))]);
    assert.equal(r.errors.length, 1);
    assert.equal(r.created.length, 1);
  });
});

describe("upsertVia / nextEventId", () => {
  it("nextEventId nối đuôi r1, r2... mà không chồng đuôi", () => {
    assert.equal(nextEventId("lms13664", 1), "lms13664r1");
    assert.equal(nextEventId("lms13664r1", 1), "lms13664r2");
    assert.equal(nextEventId("lms13664r3", 2), "lms13664r5");
  });

  it("id đã tồn tại và còn sống thì patch, giữ nguyên id", async () => {
    const store: Store = new Map([["lms1", { summary: "cũ" }]]);
    const res = await upsertVia(fakeEventsApi(store, new Set(), "c"), "lms1", { summary: "mới" }, "c");
    assert.equal(res.action, "updated");
    assert.equal(res.eventId, "lms1");
    assert.equal(store.get("lms1")?.summary, "mới");
  });

  it("10 id liên tiếp đều là bản đã xóa thì báo lỗi rõ ràng thay vì lặp mãi", async () => {
    const dead = new Set(["lms1", ...Array.from({ length: 9 }, (_, i) => `lms1r${i + 1}`)].map((id) => `c|${id}`));
    await assert.rejects(upsertVia(fakeEventsApi(new Map(), dead, "c"), "lms1", { summary: "x" }, "c"), /bản đã xóa/);
  });
});
