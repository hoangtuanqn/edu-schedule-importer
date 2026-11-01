import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { openDb, type Db } from "../../db/database.js";
import { alertOnce } from "./alert.js";
import type { NotificationChannel, NotificationMessage } from "./notify.types.js";

const msg: NotificationMessage = { subject: "Sự cố", title: "Sự cố", sections: [] };
const HOUR = 3600 * 1000;
const T0 = new Date("2026-11-01T10:00:00Z");

const channel = (opts: { enabled?: boolean; fail?: boolean } = {}) => {
  const c = {
    name: "fake", sent: 0,
    isEnabled: () => opts.enabled ?? true,
    async send() { if (opts.fail) throw new Error("hỏng"); c.sent++; },
  };
  return c satisfies NotificationChannel & { sent: number };
};

describe("alertOnce", () => {
  let db: Db;
  beforeEach(() => { db = openDb(":memory:"); });

  it("lần đầu gửi; lặp lại trong 24 giờ thì bỏ qua; sau 24 giờ thì gửi lại", async () => {
    const ch = channel();
    assert.equal((await alertOnce(db, "auth", msg, { now: T0, channels: [ch] })).status, "sent");
    assert.equal((await alertOnce(db, "auth", msg, { now: new Date(+T0 + 6 * HOUR), channels: [ch] })).status, "cooldown");
    assert.equal((await alertOnce(db, "auth", msg, { now: new Date(+T0 + 23 * HOUR), channels: [ch] })).status, "cooldown");
    assert.equal(ch.sent, 1);
    assert.equal((await alertOnce(db, "auth", msg, { now: new Date(+T0 + 25 * HOUR), channels: [ch] })).status, "sent");
    assert.equal(ch.sent, 2);
  });

  it("mỗi loại sự cố (key) có thời gian chờ riêng", async () => {
    const ch = channel();
    await alertOnce(db, "auth", msg, { now: T0, channels: [ch] });
    assert.equal((await alertOnce(db, "lms-url", msg, { now: T0, channels: [ch] })).status, "sent");
    assert.equal(ch.sent, 2);
  });

  it("chưa bật kênh nào hoặc gửi lỗi thì KHÔNG tính là đã cảnh báo (lần sau thử lại)", async () => {
    const off = await alertOnce(db, "auth", msg, { now: T0, channels: [channel({ enabled: false })] });
    assert.equal(off.status, "no-channel");
    const bad = await alertOnce(db, "auth", msg, { now: T0, channels: [channel({ fail: true })] });
    assert.equal(bad.status, "failed");
    assert.equal(bad.results[0].error, "hỏng");

    const ok = channel();
    assert.equal((await alertOnce(db, "auth", msg, { now: new Date(+T0 + HOUR), channels: [ok] })).status, "sent");
  });
});
