import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLmsNotification, hasChanges } from "../lms/lms.notification.js";
import type { SyncReport } from "../lms/lms.sync.js";
import { renderHtml, renderText } from "./notify.render.js";
import { notify } from "./notify.service.js";
import type {
  NotificationChannel,
  NotificationMessage,
} from "./notify.types.js";

const msg: NotificationMessage = {
  subject: "Thử",
  title: "Tiêu đề <b>",
  sections: [
    {
      heading: "Mục",
      tone: "danger",
      items: ["a & b", { text: "c", details: ["chi tiết <x>"] }],
    },
  ],
};

const emptyReport = (over: Partial<SyncReport> = {}): SyncReport => ({
  startedAt: "2026-11-01T03:00:00.000Z",
  durationMs: 0,
  dryRun: false,
  timeZone: "Asia/Ho_Chi_Minh",
  courses: ["PRO192"],
  feedTotal: 0,
  ignoredCourses: [],
  newlyStored: 0,
  created: [],
  updated: [],
  restored: [],
  moved: [],
  unchanged: 0,
  changedInLms: [],
  missingInLms: [],
  errors: [],
  ...over,
});

const ch = (
  name: string,
  enabled: boolean,
  fail = false,
): NotificationChannel & { sent: number } => {
  const c = {
    name,
    sent: 0,
    isEnabled: () => enabled,
    async send() {
      if (fail) throw new Error("hỏng");
      c.sent++;
    },
  };
  return c;
};

describe("render", () => {
  it("escape HTML để nội dung không phá email", () => {
    const html = renderHtml(msg);
    assert.ok(
      html.includes("a &amp; b") &&
        html.includes("&lt;x&gt;") &&
        html.includes("Tiêu đề &lt;b&gt;"),
    );
    assert.ok(!html.includes("<x>"));
  });
  it("text có đủ mục và dòng chi tiết", () => {
    const t = renderText(msg);
    assert.ok(
      t.includes("MỤC (2)") &&
        t.includes("• a & b") &&
        t.includes("chi tiết <x>"),
    );
  });
  it("thay đổi cũ → mới: text dùng mũi tên, HTML gạch cũ và in đậm mới", () => {
    const m: NotificationMessage = {
      subject: "s",
      title: "t",
      sections: [
        {
          heading: "Đổi",
          items: [
            { text: "x", details: [{ label: "Hạn", from: "cũ", to: "mới" }] },
          ],
        },
      ],
    };
    assert.ok(renderText(m).includes("Hạn: cũ  →  mới"));
    const html = renderHtml(m);
    assert.ok(html.includes("line-through") && html.includes("<strong"));
  });
  it("preheader ẩn được đưa vào HTML", () => {
    assert.ok(
      renderHtml({ ...msg, preheader: "xem trước" }).includes("display:none"),
    );
  });
});

describe("notify", () => {
  it("chỉ gửi qua kênh đang bật, một kênh lỗi không chặn kênh khác và không throw", async () => {
    const on = ch("on", true),
      off = ch("off", false),
      bad = ch("bad", true, true);
    const res = await notify(msg, [bad, off, on]);
    assert.deepEqual(
      res.map((r) => [r.channel, r.ok]),
      [
        ["bad", false],
        ["on", true],
      ],
    );
    assert.equal(res[0].error, "hỏng");
    assert.equal(on.sent, 1);
    assert.equal(off.sent, 0);
  });
  it("không có kênh nào bật => kết quả rỗng", async () => {
    assert.deepEqual(await notify(msg, [ch("off", false)]), []);
  });
});

const it1 = (uid: string, title: string, dueAt: string, code = "PRO192") => ({
  uid,
  courseCode: code,
  title,
  summary: `[${code}] ${title}`,
  dueAt,
});
const DUE_OLD = "2026-10-31T16:00:00.000Z"; // 23:00 Th 7, 31/10 (UTC+7)
const DUE_NEW = "2026-11-02T16:00:00.000Z"; // 23:00 Th 2, 02/11

describe("buildLmsNotification", () => {
  it("không đổi gì, hoặc chỉ cập nhật do đổi cấu hình => không gửi mail", () => {
    assert.equal(
      hasChanges(emptyReport({ unchanged: 5, feedTotal: 5 })),
      false,
    );
    assert.equal(
      hasChanges(emptyReport({ updated: [it1("1", "Lab", DUE_OLD)] })),
      false,
    );
  });

  it("lỗi cũng được coi là biến động", () => {
    assert.equal(
      hasChanges(
        emptyReport({
          errors: [{ ...it1("1", "Lab", DUE_OLD), error: "boom" }],
        }),
      ),
      true,
    );
  });

  it("một sự kiện mới: subject nêu rõ môn, tên và hạn", () => {
    const m = buildLmsNotification(
      emptyReport({ created: [it1("1", "Assignment", DUE_OLD)] }),
    );
    assert.equal(
      m.subject,
      "[LMS] Bài mới: PRO192 Assignment - hạn 23:00 Th 7, 31/10",
    );
  });

  it("một sự kiện đổi hạn: subject nêu hạn cũ → mới, nội dung có cũ/mới", () => {
    const c = {
      ...it1("1", "Assignment", DUE_NEW),
      changes: [{ field: "dueAt" as const, from: DUE_OLD, to: DUE_NEW }],
    };
    const m = buildLmsNotification(
      emptyReport({ changedInLms: [c], updated: [c] }),
    );
    assert.equal(
      m.subject,
      "[LMS] Đổi hạn nộp: PRO192 Assignment - 23:00 Th 7, 31/10 → 23:00 Th 2, 02/11",
    );
    const text = renderText(m);
    assert.ok(
      text.includes("Hạn nộp: 23:00 Th 7, 31/10  →  23:00 Th 2, 02/11"),
    );
    assert.equal(m.sections.length, 1); // mục "cập nhật do cấu hình" không lặp lại
  });

  it("một sự kiện bị LMS xóa / đổi nội dung / khôi phục / lỗi có subject riêng", () => {
    const subj = (over: Partial<SyncReport>) =>
      buildLmsNotification(emptyReport(over)).subject;
    const x = it1("1", "Lab", DUE_OLD);
    assert.equal(
      subj({ missingInLms: [x] }),
      "[LMS] LMS đã xóa: PRO192 Lab (hạn 23:00 Th 7, 31/10)",
    );
    assert.equal(subj({ restored: [x] }), "[LMS] Đã khôi phục: PRO192 Lab");
    assert.equal(
      subj({ errors: [{ ...x, error: "e" }] }),
      "[LMS] Lỗi đồng bộ: PRO192 Lab",
    );
    const content = {
      ...x,
      changes: [{ field: "summary" as const, from: "a", to: "b" }],
    };
    assert.equal(
      subj({ changedInLms: [content] }),
      "[LMS] Đổi nội dung: PRO192 Lab",
    );
  });

  it("nhiều thay đổi: subject xếp theo mức quan trọng và liệt kê môn bị ảnh hưởng", () => {
    const due = {
      ...it1("1", "A", DUE_NEW),
      changes: [{ field: "dueAt" as const, from: DUE_OLD, to: DUE_NEW }],
    };
    const m = buildLmsNotification(
      emptyReport({
        created: [
          it1("2", "B", DUE_NEW, "OSG202"),
          it1("3", "C", DUE_NEW, "OSG202"),
        ],
        changedInLms: [due],
        missingInLms: [it1("4", "D", DUE_OLD)],
      }),
    );
    assert.equal(
      m.subject,
      "[LMS] 1 bị xóa · 1 đổi hạn · 2 mới - OSG202, PRO192",
    );
    assert.deepEqual(
      m.sections.map((s) => s.heading),
      ["LMS đã xóa", "LMS thay đổi", "Sự kiện mới"],
    );
    assert.deepEqual(m.highlights, ["1 bị xóa", "1 đổi hạn", "2 mới"]);
    assert.ok(m.preheader?.includes("và 3 thay đổi khác"));
  });

  it("hiển thị thời gian còn lại đến hạn", () => {
    // startedAt = 2026-11-01T03:00Z; hạn sau 2 ngày 13 giờ
    const due = new Date(
      Date.parse("2026-11-01T03:00:00Z") + (2 * 24 + 13) * 3600 * 1000,
    ).toISOString();
    const t = renderText(
      buildLmsNotification(emptyReport({ created: [it1("1", "X", due)] })),
    );
    assert.ok(t.includes("còn 2 ngày 13 giờ"));
    const past = renderText(
      buildLmsNotification(
        emptyReport({ restored: [it1("1", "X", "2026-10-30T00:00:00.000Z")] }),
      ),
    );
    assert.ok(past.includes("đã quá hạn"));
  });

  it("subject không dài quá 110 ký tự", () => {
    const long = it1("1", "x".repeat(300), DUE_OLD);
    assert.ok(
      buildLmsNotification(emptyReport({ created: [long] })).subject.length <=
        110,
    );
  });
});
