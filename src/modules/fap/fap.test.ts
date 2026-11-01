import assert from "node:assert/strict";
import fs from "node:fs";
import { beforeEach, describe, it } from "node:test";
import { openDb, type Db } from "../../db/database.js";
import { fakeGoogle } from "../../test-utils/fakeGoogle.js";
import type { LmsConfig } from "../lms/lms.config.js";
import { buildFapNotification, hasFapChanges, MAX_ITEMS } from "./fap.notification.js";
import { parseWeeklyTimetable, weekContains } from "./fap.parser.js";
import { runFapSync, type FapImport } from "./fap.sync.js";

const fixture = (name: string) => fs.readFileSync(new URL(`./__fixtures__/${name}.html`, import.meta.url), "utf8");
const CLASS_HTML = fixture("weekly-class"); // tuần 26/10 - 01/11: 8 buổi học
const EXAM_HTML = fixture("weekly-exam"); // tuần 16/11 - 22/11: 4 buổi thi
const ONLINE_HTML = fixture("weekly-online"); // tuần 23/11 - 29/11: lớp online có link Meet + lịch thi không có phòng
const PARTIAL_HTML = fixture("weekly-partial"); // phản hồi thô của /WeeklyTimetable/WeekPartial (tuần 09/11 - 15/11)
const NOW = new Date("2026-11-01T03:00:00Z");

/** Mọi mã môn xuất hiện trong các file mẫu */
const ALL_COURSES = ["MAD101", "NWC204", "OSG202", "PRO192", "WED201C"];

/**
 * Cấu hình giả. FAP lấy TẤT CẢ môn (không dùng \`courses\`, vốn chỉ để lọc LMS), nên để một test chỉ xét vài môn
 * thì loại trừ phần còn lại qua \`fap.ignoreCourses\`. \`only\` bỏ trống = không loại môn nào.
 */
const cfg = (only?: string[]): LmsConfig => ({
  courses: ["KHÔNG-ẢNH-HƯỞNG-FAP"], eventDurationMinutes: 30, timeZone: "Asia/Ho_Chi_Minh", calendar: "Nhắc nhở", eventColor: "", reminderMinutes: [],
  fap: {
    ignoreCourses: only ? ALL_COURSES.filter((c) => !only.includes(c)) : [],
    calendar: "Học tập ở ngoài", classColor: "", examColor: "tomato", classReminderMinutes: [60], examReminderMinutes: [4320, 1440, 180],
  },
});

describe("parseWeeklyTimetable", () => {
  it("tuần học: đọc đúng ngày theo cột, giờ, phòng, giảng viên; bỏ qua điểm danh", () => {
    const w = parseWeeklyTimetable(CLASS_HTML, NOW);
    assert.equal(w.weekStart, "2026-10-26");
    assert.equal(w.weekEnd, "2026-11-01");
    assert.equal(w.sessions.length, 8);
    assert.equal(w.warnings.length, 0);
    assert.ok(w.sessions.every((s) => s.kind === "class" && !s.online));

    const mad = w.sessions.filter((s) => s.courseCode === "MAD101");
    assert.deepEqual(mad.map((s) => s.date).sort(), ["2026-10-27", "2026-10-30"]); // Thứ 3 và Thứ 6
    assert.deepEqual(
      { ...mad[0], id: undefined },
      { id: undefined, kind: "class", courseCode: "MAD101", className: "AI2101", date: mad[0].date, slot: 1, startTime: "07:00", endTime: "09:15", room: "P.124", lecturer: "gv_a", online: false, meetUrl: null },
    );
    const pro = w.sessions.find((s) => s.courseCode === "PRO192" && s.date === "2026-10-28")!;
    assert.deepEqual([pro.slot, pro.startTime, pro.endTime, pro.room], [2, "09:30", "11:45", "P.338"]);
  });

  it("tuần thi: nhận ra lịch thi, ô nằm đúng cột ngày, giảng viên '-' thành trống", () => {
    const w = parseWeeklyTimetable(EXAM_HTML, NOW);
    assert.equal(w.sessions.length, 4);
    assert.ok(w.sessions.every((s) => s.kind === "exam" && s.lecturer === null));

    const pick = (code: string) => w.sessions.filter((s) => s.courseCode === code).map((s) => [s.date, s.startTime, s.endTime, s.room]);
    assert.deepEqual(pick("MAD101"), [["2026-11-20", "14:30", "16:00", "111"]]); // Thứ 6
    assert.deepEqual(pick("OSG202"), [["2026-11-21", "10:50", "12:20", "212"]]); // Thứ 7
    assert.deepEqual(pick("NWC204"), [["2026-11-18", "09:10", "10:50", "213"], ["2026-11-18", "11:00", "12:20", "213"]]); // 2 buổi cùng ngày
  });

  it("id ổn định giữa các lần đọc và không phụ thuộc giờ/phòng/giảng viên", () => {
    const a = parseWeeklyTimetable(CLASS_HTML, NOW).sessions;
    const edited = CLASS_HTML.replaceAll("P.124", "P.201").replaceAll("gv_a", "gv_z").replaceAll("07h00-09h15", "07h30-09h45");
    const b = parseWeeklyTimetable(edited, NOW).sessions;
    assert.deepEqual(a.map((s) => s.id), b.map((s) => s.id));
    assert.equal(new Set(a.map((s) => s.id)).size, 8);
  });

  it("tuần vắt qua năm mới thì tăng năm cho đúng", () => {
    const th = (t: string) => `<th>${t}</th>`;
    const html = `<table><thead><tr><th>Slot</th>${["Thứ 2 (28/12)", "Thứ 3 (29/12)", "Thứ 4 (30/12)", "Thứ 5 (31/12)", "Thứ 6 (01/01)", "Thứ 7 (02/01)", "Chủ nhật (03/01)"].map(th).join("")}</tr></thead>
      <tbody><tr><th>1</th>${"<td>-</td>".repeat(4)}<td><div class="position-relative"><div title="Lớp học">MAD101 - AI2101</div>
      <div title="Giờ bắt đầu - Giờ kết thúc"><span>07h00-09h15</span> - <span title="Học online">Offline</span></div></div></td>${"<td>-</td>".repeat(2)}</tr></tbody></table>`;
    const w = parseWeeklyTimetable(html, new Date("2026-12-30T03:00:00Z"));
    assert.equal(w.weekStart, "2026-12-28");
    assert.equal(w.weekEnd, "2027-01-03");
    assert.equal(w.sessions[0].date, "2027-01-01");
  });

  it("ô không đọc được giờ thì bỏ qua và cảnh báo; không có bảng thì báo lỗi", () => {
    const broken = EXAM_HTML.replace("14h30-16h00", "chưa xếp giờ");
    const w = parseWeeklyTimetable(broken, NOW);
    assert.equal(w.sessions.length, 3);
    assert.equal(w.warnings.length, 1);
    assert.match(w.warnings[0], /MAD101/);
    assert.throws(() => parseWeeklyTimetable("<div>không có bảng</div>"), /Không tìm thấy bảng/);
  });
});

describe("lớp online và lịch thi thiếu thông tin", () => {
  it("lớp online: đọc được link Meet, phòng và giảng viên; lịch thi không có phòng thì phòng trống", () => {
    const w = parseWeeklyTimetable(ONLINE_HTML, new Date("2026-11-23T00:00:00Z"));
    assert.equal(w.sessions.length, 7);

    const wed = w.sessions.find((s) => s.courseCode === "WED201C")!; // "WED201c" trên FAP, chuẩn hóa chữ hoa để so khớp
    assert.deepEqual(
      [wed.kind, wed.className, wed.date, wed.slot, wed.startTime, wed.endTime, wed.online, wed.meetUrl, wed.room, wed.lecturer],
      ["class", "WED201c_FA26_01", "2026-11-23", 7, "17:45", "19:15", true, "https://meet.google.com/auq-xdbe-oey", "118", "gv_e"],
    );

    const exams = w.sessions.filter((s) => s.kind === "exam");
    assert.equal(exams.length, 6);
    assert.ok(exams.every((s) => !s.online && s.meetUrl === null && s.lecturer === null));
    assert.deepEqual(exams.filter((s) => s.room === null).length, 5); // chỉ PRO192 ngày 25/11 có phòng 111
    assert.deepEqual(w.sessions.filter((s) => s.courseCode === "NWC204").map((s) => [s.date, s.slot, s.startTime]), [["2026-11-26", 4, "12:50"], ["2026-11-26", 5, "14:40"]]);
    assert.deepEqual(w.sessions.filter((s) => s.courseCode === "PRO192").map((s) => s.date).sort(), ["2026-11-25", "2026-11-29"]); // 2 buổi thi cùng môn
  });
});

describe("phản hồi thô của /WeeklyTimetable/WeekPartial", () => {
  it("đọc được dù ký tự tiếng Việt bị mã hóa (&#x1EDB;...) và có thêm phần giao diện di động", () => {
    const w = parseWeeklyTimetable(PARTIAL_HTML, new Date("2026-11-09T00:00:00Z"));
    assert.equal(w.weekStart, "2026-11-09");
    assert.equal(w.weekEnd, "2026-11-15");
    assert.equal(w.sessions.length, 5); // chỉ tính bảng chính (3 + 2 buổi), không tính lại thẻ di động
    const nwc = w.sessions.filter((s) => s.courseCode === "NWC204");
    assert.deepEqual(nwc.map((s) => [s.date, s.startTime, s.room, s.lecturer]), [["2026-11-09", "09:30", "P.303", "gv_b"]]);
    const mad = w.sessions.filter((s) => s.courseCode === "MAD101").map((s) => s.date).sort();
    assert.deepEqual(mad, ["2026-11-10", "2026-11-13"]);
  });

  it("weekContains: referenceDate là Chủ nhật cuối tuần thì nằm trong tuần trả về; ngày của tuần khác thì không", () => {
    const w = parseWeeklyTimetable(PARTIAL_HTML, new Date("2026-11-09T00:00:00Z")); // tuần 09/11 - 15/11
    assert.equal(weekContains(w, "2026-11-15"), true); // Chủ nhật cuối tuần
    assert.equal(weekContains(w, "2026-11-09"), true); // thứ Hai đầu tuần
    assert.equal(weekContains(w, "2026-11-16"), false); // tuần sau
    assert.equal(weekContains(w, "2026-11-08"), false); // tuần trước
  });

  it("referenceDate giúp suy ra đúng năm cho tuần xa hơn 6 tháng so với hôm nay", () => {
    const html = PARTIAL_HTML.replaceAll("(09/11)", "(01/03)").replaceAll("(10/11)", "(02/03)").replaceAll("(11/11)", "(03/03)")
      .replaceAll("(12/11)", "(04/03)").replaceAll("(13/11)", "(05/03)").replaceAll("(14/11)", "(06/03)").replaceAll("(15/11)", "(07/03)");
    assert.equal(parseWeeklyTimetable(html, new Date("2027-03-01T00:00:00Z")).weekStart, "2027-03-01");
    assert.equal(parseWeeklyTimetable(html, new Date("2026-03-01T00:00:00Z")).weekStart, "2026-03-01");
  });
});

describe("runFapSync", () => {
  let db: Db;
  beforeEach(() => { db = openDb(":memory:"); });

  const imp = (...htmls: string[]): FapImport => ({ weeks: htmls.map((h) => parseWeeklyTimetable(h, NOW)) });
  const run = (g: ReturnType<typeof fakeGoogle>, i: FapImport | undefined, courses: string[], opts: { dryRun?: boolean; now?: Date } = {}) =>
    runFapSync({ db, cfg: cfg(courses), gateway: g.gateway, import: i, now: NOW, ...opts });
  const eventOf = (g: ReturnType<typeof fakeGoogle>, summary: string) => [...g.store.values()].find((e) => e.summary === summary)!;

  it("lịch thi: thêm tiền tố [Thi], màu đỏ, lời nhắc riêng, đủ giờ/phòng/giảng viên; bỏ môn không theo dõi", async () => {
    const g = fakeGoogle();
    const r = await run(g, imp(EXAM_HTML), ["MAD101", "OSG202"]);

    assert.equal(r.created.length, 2);
    assert.deepEqual(r.ignoredCourses, ["NWC204"]);
    assert.equal(g.store.size, 2);

    const e = eventOf(g, "[Thi] OSG202 - SE2113");
    assert.equal(e.colorId, "11");
    assert.equal(e.location, "Phòng 212");
    assert.deepEqual(e.start, { dateTime: "2026-11-21T10:50:00", timeZone: "Asia/Ho_Chi_Minh" });
    assert.deepEqual(e.end, { dateTime: "2026-11-21T12:20:00", timeZone: "Asia/Ho_Chi_Minh" });
    assert.deepEqual(e.reminders?.overrides?.map((o) => o.minutes), [4320, 1440, 180]);
    for (const line of ["Lịch thi", "Lớp: SE2113", "Giờ: 10:50 - 12:20", "Hình thức: Offline", "Phòng: 212", "Giảng viên: (chưa có)"]) {
      assert.ok(e.description?.includes(line), `thiếu dòng "${line}" trong mô tả`);
    }
  });

  it("lịch học: tiêu đề không tiền tố, có phòng và giảng viên, nhắc trước 60 phút", async () => {
    const g = fakeGoogle();
    const r = await run(g, imp(CLASS_HTML), ["MAD101", "OSG202", "PRO192"]);
    assert.equal(r.created.length, 6);
    assert.deepEqual(r.ignoredCourses, ["NWC204"]);

    const e = eventOf(g, "MAD101 - AI2101");
    assert.equal(e.location, "Phòng 124"); // "P.124" -> "Phòng 124"
    assert.equal(e.colorId, undefined); // không đặt màu riêng => lấy màu của lịch
    assert.ok(e.description?.includes("Lịch học") && e.description.includes("Giảng viên: gv_a"));
    assert.deepEqual(e.reminders?.overrides?.map((o) => o.minutes), [60]);
  });

  it("nhập lại y nguyên (kể cả điểm danh đổi) thì không có gì thay đổi", async () => {
    const g = fakeGoogle();
    await run(g, imp(CLASS_HTML), ["MAD101"]);
    const r = await run(g, imp(CLASS_HTML.replaceAll("Có mặt", "Vắng")), ["MAD101"]);
    assert.equal(r.created.length + r.updated.length + r.changed.length + r.restored.length, 0);
    assert.equal(r.unchanged, 2);
  });

  it("đổi phòng / giảng viên / giờ học thì cập nhật Google và ghi lại trước-sau", async () => {
    const g = fakeGoogle();
    await run(g, imp(CLASS_HTML), ["MAD101"]);

    const edited = CLASS_HTML.replaceAll("P.124", "P.201").replaceAll("gv_a", "gv_z").replaceAll("07h00-09h15", "07h30-09h45");
    const r = await run(g, imp(edited), ["MAD101"]);

    assert.equal(r.updated.length, 2);
    assert.equal(r.changed.length, 2);
    assert.deepEqual(
      r.changed[0].changes.map((c) => [c.field, c.from, c.to]).sort(),
      [["lecturer", "gv_a", "gv_z"], ["room", "P.124", "P.201"], ["time", "07:00-09:15", "07:30-09:45"]],
    );
    const e = eventOf(g, "MAD101 - AI2101");
    assert.equal(e.location, "Phòng 201");
    assert.ok(e.description?.includes("Giảng viên: gv_z") && e.description.includes("Giờ: 07:30 - 09:45"));
    assert.equal(e.start?.dateTime?.slice(11), "07:30:00");
  });

  it("giảng viên được bổ sung sau (từ '-') hoặc bị bỏ trống cũng được cập nhật", async () => {
    const g = fakeGoogle();
    await run(g, imp(EXAM_HTML), ["MAD101"]);
    assert.ok(eventOf(g, "[Thi] MAD101 - AI2101").description?.includes("Giảng viên: (chưa có)"));

    // thêm giảng viên và bỏ trống phòng, chỉ cho ô của MAD101 (nằm sau chữ "MAD101" trong trang)
    const at = EXAM_HTML.indexOf("MAD101");
    const tail = EXAM_HTML.slice(at).replace(/(title="Giảng viên">\s*<i class="ri-user-line"><\/i>\s*)-/, "$1gv_x").replace("111", "-");
    const edited = EXAM_HTML.slice(0, at) + tail;
    const r = await run(g, imp(edited), ["MAD101"]);
    assert.equal(r.updated.length, 1);
    const e = eventOf(g, "[Thi] MAD101 - AI2101");
    assert.ok(e.description?.includes("Giảng viên: gv_x") && e.description.includes("Phòng: (chưa có)"));
    assert.equal(e.location, null); // null = xóa địa điểm cũ
  });

  it("xóa trên Google thì khôi phục (kể cả khi Google giữ bản cancelled)", async () => {
    const g = fakeGoogle();
    await run(g, imp(EXAM_HTML), ["MAD101"]);
    g.wipe();

    const r = await run(g, undefined, ["MAD101"]); // chỉ đối chiếu, không cần mở FAP
    assert.equal(r.restored.length, 1);
    assert.equal(r.errors.length, 0);
    assert.equal(g.store.size, 1);
    assert.ok([...g.store.keys()][0].endsWith("r1")); // id mới vì id cũ là bản đã xóa

    assert.equal((await run(g, undefined, ["MAD101"])).unchanged, 1);
  });

  it("chỉ khôi phục buổi trong 10 ngày trở lại; buổi cũ hơn thì để yên", async () => {
    const g = fakeGoogle();
    await run(g, imp(CLASS_HTML), ["MAD101"]); // buổi 27/10 và 30/10
    g.wipe();

    // 10/11: 27/10 đã cách 14 ngày, 30/10 đã cách 11 ngày => cả hai quá cũ
    const r = await run(g, undefined, ["MAD101"], { now: new Date("2026-11-10T03:00:00Z") });
    assert.equal(r.restored.length, 0);
    // 08/11: 30/10 cách 9 ngày (còn trong cửa sổ), 27/10 cách 12 ngày (quá cũ)
    const r2 = await run(g, undefined, ["MAD101"], { now: new Date("2026-11-08T03:00:00Z") });
    assert.deepEqual(r2.restored.map((s) => s.date), ["2026-10-30"]);
  });

  it("buổi biến mất khỏi tuần vừa nhập thì báo là bị hủy/dời, không động tới Google", async () => {
    const g = fakeGoogle();
    const week = imp(CLASS_HTML);
    await run(g, week, ["MAD101", "OSG202"]);
    const upserts = g.calls.upsert;

    const r = await run(g, { weeks: [{ ...week.weeks[0], sessions: week.weeks[0].sessions.filter((s) => s.courseCode !== "MAD101") }] }, ["MAD101", "OSG202"]);
    assert.equal(r.missing.length, 2);
    assert.equal(g.calls.upsert, upserts);
    assert.equal(g.store.size, 4); // sự kiện cũ vẫn còn trên Google

    // buổi quay lại thì không còn bị coi là mất
    assert.equal((await run(g, week, ["MAD101", "OSG202"])).missing.length, 0);
  });

  it("nhập nhiều tuần trong MỘT lần: lưu hết, đồng bộ một lần, báo khoảng ngày đã quét", async () => {
    const g = fakeGoogle();
    const r = await run(g, imp(CLASS_HTML, PARTIAL_HTML, EXAM_HTML), ["MAD101", "OSG202", "PRO192"]);

    assert.deepEqual(r.range, { start: "2026-10-26", end: "2026-11-22", weeks: 3 });
    assert.equal(r.parsedTotal, 8 + 5 + 4);
    assert.equal(r.created.length, 6 + 4 + 2); // tuần học 6 + tuần partial 4 (trừ NWC204) + 2 lịch thi
    assert.equal(g.store.size, r.created.length);
    assert.deepEqual(r.ignoredCourses, ["NWC204"]);
  });

  it("tuần không được gửi lên lần này thì không bị coi là mất; tuần gửi lên mà rỗng thì buổi cũ bị coi là mất", async () => {
    const g = fakeGoogle();
    await run(g, imp(CLASS_HTML, PARTIAL_HTML), ["MAD101", "OSG202", "PRO192"]);

    // lần sau chỉ gửi tuần PARTIAL: tuần CLASS không được nhắc tới => không động tới
    const r1 = await run(g, imp(PARTIAL_HTML), ["MAD101", "OSG202", "PRO192"]);
    assert.equal(r1.missing.length, 0);

    // lần sau gửi tuần PARTIAL nhưng bảng rỗng (mọi buổi bị hủy) => các buổi cũ của tuần đó bị báo mất
    const week = { ...parseWeeklyTimetable(PARTIAL_HTML, NOW), sessions: [] };
    const r2 = await run(g, { weeks: [week] }, ["MAD101", "OSG202", "PRO192"]);
    assert.equal(r2.missing.length, 4); // 4 buổi của các môn đang theo dõi trong tuần đó
  });

  it("lớp online: địa điểm là link Meet, mô tả có link; lịch thi không phòng thì không có địa điểm", async () => {
    const g = fakeGoogle();
    const r = await run(g, imp(ONLINE_HTML), ["WED201C", "NWC204", "PRO192", "MAD101", "OSG202"]);
    assert.equal(r.created.length, 7);
    assert.equal(r.errors.length, 0);

    const online = eventOf(g, "WED201C - WED201c_FA26_01");
    assert.equal(online.location, "https://meet.google.com/auq-xdbe-oey");
    for (const line of ["Lịch học", "Hình thức: Online", "Link Meet: https://meet.google.com/auq-xdbe-oey", "Phòng: 118", "Giảng viên: gv_e"]) {
      assert.ok(online.description?.includes(line), `thiếu "${line}"`);
    }
    assert.equal(online.colorId, undefined);
    assert.deepEqual(online.reminders?.overrides?.map((o) => o.minutes), [60]);

    const exam = [...g.store.values()].find((e) => e.summary === "[Thi] NWC204 - SE2113")!;
    assert.equal(exam.location, undefined);
    assert.ok(exam.description?.includes("Phòng: (chưa có)") && exam.description.includes("Giảng viên: (chưa có)"));
    assert.equal(exam.colorId, "11");
    assert.equal(g.store.size, 7);
  });

  it("đổi link Meet thì cập nhật địa điểm và ghi lại trước-sau", async () => {
    const g = fakeGoogle();
    await run(g, imp(ONLINE_HTML), ["WED201C"]);
    const r = await run(g, imp(ONLINE_HTML.replaceAll("auq-xdbe-oey", "new-link-xyz")), ["WED201C"]);
    assert.equal(r.updated.length, 1);
    assert.deepEqual(r.changed[0].changes.map((c) => [c.field, c.to]), [["meet", "https://meet.google.com/new-link-xyz"]]);
    assert.equal(eventOf(g, "WED201C - WED201c_FA26_01").location, "https://meet.google.com/new-link-xyz");
  });

  it("mặc định lấy TẤT CẢ môn trong lịch FAP, không phụ thuộc danh sách courses (chỉ dành cho LMS)", async () => {
    const g = fakeGoogle();
    const config = cfg(); // courses = ["KHÔNG-ẢNH-HƯỞNG-FAP"], ignoreCourses rỗng
    const r = await runFapSync({ db, cfg: config, gateway: g.gateway, import: imp(ONLINE_HTML, CLASS_HTML), now: NOW });

    assert.deepEqual(r.ignoredCourses, []);
    assert.equal(r.created.length, 7 + 8);
    assert.deepEqual([...new Set(r.created.map((s) => s.courseCode))].sort(), ["MAD101", "NWC204", "OSG202", "PRO192", "WED201C"]);
    assert.ok(eventOf(g, "WED201C - WED201c_FA26_01"), "lớp WED201c phải có trên lịch");
    assert.equal([...g.store.values()].filter((e) => e.summary === "[Thi] NWC204 - SE2113").length, 2);
  });

  it("fap.ignoreCourses chỉ bỏ đúng môn được liệt kê, kể cả ở bước đối chiếu lại", async () => {
    const g = fakeGoogle();
    const exclude = { ...cfg(), fap: { ...cfg().fap, ignoreCourses: ["NWC204"] } };

    // lưu cả 7 buổi nhưng chưa đẩy lên Google
    await runFapSync({ db, cfg: cfg(), gateway: g.gateway, import: imp(ONLINE_HTML), now: NOW, dryRun: true });
    const r = await runFapSync({ db, cfg: exclude, gateway: g.gateway, import: imp(ONLINE_HTML), now: NOW });

    assert.deepEqual(r.ignoredCourses, ["NWC204"]);
    assert.equal(r.created.length, 5);
    assert.ok(![...g.store.values()].some((e) => e.summary?.includes("NWC204")));

    // chạy chỉ đối chiếu (như \`npm start\`) cũng không đẩy môn bị loại trừ lên
    const again = await runFapSync({ db, cfg: exclude, gateway: g.gateway, now: NOW });
    assert.equal(again.created.length, 0);
    assert.equal(g.store.size, 5);
  });

  it("môn bị loại trừ được báo rõ là bị bỏ qua (cả trong email)", async () => {
    const g = fakeGoogle();
    const r = await run(g, imp(ONLINE_HTML), ["PRO192"]);
    assert.deepEqual(r.ignoredCourses, ["MAD101", "NWC204", "OSG202", "WED201C"]);
    assert.equal(r.created.length, 2); // 2 buổi thi PRO192
    assert.match(buildFapNotification(r).footer ?? "", /Bỏ qua theo cấu hình fap\.ignoreCourses: MAD101, NWC204, OSG202, WED201C/);
  });

  it("chạy thử (dryRun) không ghi gì lên Google", async () => {
    const g = fakeGoogle();
    const r = await run(g, imp(EXAM_HTML), ["MAD101"], { dryRun: true });
    assert.equal(r.created.length, 1);
    assert.equal(g.calls.upsert, 0);
    assert.equal((await run(g, undefined, ["MAD101"])).created.length, 1);
  });
});

const fakeReport = (): import("./fap.sync.js").FapReport => ({
  startedAt: NOW.toISOString(), durationMs: 0, dryRun: false, timeZone: "Asia/Ho_Chi_Minh", excludedCourses: [], parsedTotal: 0,
  ignoredCourses: [], warnings: [], newlyStored: 0, created: [], updated: [], restored: [], changed: [], missing: [], unchanged: 0, errors: [],
});

describe("buildFapNotification", () => {
  let db: Db;
  beforeEach(() => { db = openDb(":memory:"); });
  const week = (html: string) => parseWeeklyTimetable(html, NOW);
  const run = (g: ReturnType<typeof fakeGoogle>, html: string | undefined, courses: string[]) =>
    runFapSync({ db, cfg: cfg(courses), gateway: g.gateway, import: html ? { weeks: [week(html)] } : undefined, now: NOW });

  it("một lịch thi mới: subject nêu đủ môn, giờ, phòng", async () => {
    const r = await run(fakeGoogle(), EXAM_HTML, ["MAD101"]);
    assert.ok(hasFapChanges(r));
    assert.equal(buildFapNotification(r).subject, "[FAP] Lịch thi mới: [Thi] MAD101 - AI2101 — 14:30 Th 6, 20/11 · Phòng 111");
  });

  it("nhiều lịch thi mới được nói rõ là lịch thi và xếp lên đầu", async () => {
    const r = await run(fakeGoogle(), EXAM_HTML, ["MAD101", "OSG202"]);
    const m = buildFapNotification(r);
    assert.equal(m.subject, "[FAP] 2 lịch thi mới — MAD101, OSG202");
    assert.equal(m.sections[0].heading, "Lịch thi mới");
  });

  it("đổi lịch: email nêu cũ → mới cho từng trường", async () => {
    const g = fakeGoogle();
    await run(g, CLASS_HTML, ["MAD101"]);
    const r = await run(g, CLASS_HTML.replaceAll("P.124", "P.201"), ["MAD101"]);
    const m = buildFapNotification(r);
    assert.equal(m.subject, "[FAP] 2 thay đổi — MAD101");
    assert.deepEqual(m.sections.map((s) => s.heading), ["Thay đổi"]);
    const first = m.sections[0].items[0];
    assert.ok(typeof first !== "string" && JSON.stringify(first.details).includes("P.201"));
  });

  it("lần đầu có buổi mới thì không liệt kê thêm mục 'thay đổi' cho chính các buổi đó", async () => {
    const r = await run(fakeGoogle(), CLASS_HTML, ["MAD101"]);
    assert.equal(buildFapNotification(r).sections.map((s) => s.heading).join(), "Lịch học mới");
  });

  it("lần nhập đầu có rất nhiều buổi: email chỉ liệt kê vài dòng đầu nhưng tiêu đề vẫn hiện tổng thật", () => {
    const mk = (i: number) => ({
      id: String(i), kind: "class" as const, courseCode: "MAD101", className: "AI2101", date: "2026-11-10", slot: 1, startTime: "07:00",
      endTime: "09:15", room: "P.124", lecturer: "gv_a", online: false, meetUrl: null, googleEventId: "x", googleCalendarId: null, syncedHash: null,
      syncedAt: null, restoredCount: 0, missing: false,
    });
    const r = { ...fakeReport(), created: Array.from({ length: 140 }, (_, i) => mk(i)) };
    const m = buildFapNotification(r);
    const sec = m.sections[0];
    assert.equal(sec.total, 140);
    assert.equal(sec.items.length, MAX_ITEMS + 1);
    assert.match(String(sec.items.at(-1)), /và 115 mục khác/);
    assert.equal(m.subject, "[FAP] 140 lịch học mới — MAD101");
  });

  it("không đổi gì, hoặc chỉ đổi cấu hình, thì không gửi mail", async () => {
    const g = fakeGoogle();
    await run(g, CLASS_HTML, ["MAD101"]);
    assert.equal(hasFapChanges(await run(g, CLASS_HTML, ["MAD101"])), false);

    const withReminders = { ...cfg(["MAD101"]), fap: { ...cfg(["MAD101"]).fap, classReminderMinutes: [30] } };
    const r = await runFapSync({ db, cfg: withReminders, gateway: g.gateway, now: NOW });
    assert.equal(r.updated.length, 2); // Google được cập nhật lời nhắc...
    assert.equal(hasFapChanges(r), false); // ...nhưng không phải biến động dữ liệu nên không báo
  });
});
