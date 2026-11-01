import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { openDb, type Db } from "../db/database.js";
import { cleanupLogFiles, describeCleanup, pruneHistory, runMaintenance } from "./cleanup.js";

const DAY = 24 * 3600 * 1000;
const NOW = new Date("2026-11-10T12:00:00Z");

describe("cleanupLogFiles", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "logs-test-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  /** Tạo file với nội dung `size` byte và thời điểm ghi lần cuối cách NOW `daysAgo` ngày */
  const make = (name: string, daysAgo: number, size = 100) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, "x".repeat(size));
    const t = new Date(NOW.getTime() - daysAgo * DAY);
    fs.utimesSync(file, t, t);
    return file;
  };
  const left = () => fs.readdirSync(dir).sort();

  it("xóa file log cũ hơn N ngày, giữ file mới hơn và file của hôm nay", () => {
    make("sync-2026-11-01.log", 9);
    make("sync-2026-11-02.log", 8);
    make("sync-2026-11-05.log", 5);
    make("sync-2026-11-10.log", 0);

    const r = cleanupLogFiles(dir, 7, NOW);
    assert.deepEqual(r.deleted.sort(), ["sync-2026-11-01.log", "sync-2026-11-02.log"]);
    assert.equal(r.freedBytes, 200);
    assert.deepEqual(left(), ["sync-2026-11-05.log", "sync-2026-11-10.log"]);
  });

  it("dọn cả sync.log và sync.old.log của phiên bản cũ khi đã bỏ không ghi", () => {
    make("sync.log", 10);
    make("sync.old.log", 20);
    assert.equal(cleanupLogFiles(dir, 7, NOW).deleted.length, 2);
    assert.deepEqual(left(), []);
  });

  it("không đụng tới file không phải log của mình, dù cũ", () => {
    make("ghi-chu.txt", 100);
    make("app.log", 100);
    make("backup-sync.log.bak", 100);
    make("sync-2026-10-01.log", 100);
    assert.deepEqual(cleanupLogFiles(dir, 7, NOW).deleted, ["sync-2026-10-01.log"]);
    assert.deepEqual(left(), ["app.log", "backup-sync.log.bak", "ghi-chu.txt"]);
  });

  it("không xóa thư mục con trùng tên", () => {
    fs.mkdirSync(path.join(dir, "sync-old.log"));
    assert.deepEqual(cleanupLogFiles(dir, 7, NOW).deleted, []);
    assert.ok(fs.existsSync(path.join(dir, "sync-old.log")));
  });

  it("keepDays = 0 là tắt tính năng; thư mục chưa có cũng không lỗi", () => {
    make("sync-2026-10-01.log", 100);
    assert.deepEqual(cleanupLogFiles(dir, 0, NOW).deleted, []);
    assert.deepEqual(cleanupLogFiles(path.join(dir, "khong-co"), 7, NOW).deleted, []);
    assert.equal(left().length, 1);
  });

  it("dryRun chỉ liệt kê, không xóa", () => {
    make("sync-2026-10-01.log", 100, 50);
    const r = cleanupLogFiles(dir, 7, NOW, true);
    assert.deepEqual(r.deleted, ["sync-2026-10-01.log"]);
    assert.equal(r.freedBytes, 50);
    assert.equal(left().length, 1);
  });
});

describe("pruneHistory / runMaintenance", () => {
  let db: Db;
  beforeEach(() => { db = openDb(":memory:"); });

  const addRun = (daysAgo: number) =>
    db.prepare("INSERT INTO sync_runs (started_at, duration_ms, dry_run, created, updated, restored, unchanged, errors) VALUES (?, 1, 0, 0, 0, 0, 0, 0)")
      .run(new Date(NOW.getTime() - daysAgo * DAY).toISOString());
  const addState = (key: string, daysAgo: number) => {
    const t = new Date(NOW.getTime() - daysAgo * DAY).toISOString();
    db.prepare("INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?)").run(key, t, t);
  };
  const count = (table: string) => Number((db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n);

  it("xóa lịch sử chạy cũ hơn N ngày và trạng thái cảnh báo cũ hơn 30 ngày", () => {
    [1, 30, 89, 91, 200].forEach(addRun);
    addState("alert:google-login", 2);
    addState("alert:failure:abc", 45);

    const r = pruneHistory(db, 90, NOW);
    assert.deepEqual(r, { prunedRuns: 2, prunedStates: 1 });
    assert.equal(count("sync_runs"), 3);
    assert.equal(count("app_state"), 1);
  });

  it("historyKeepDays = 0 thì giữ nguyên lịch sử chạy", () => {
    addRun(500);
    assert.equal(pruneHistory(db, 0, NOW).prunedRuns, 0);
    assert.equal(count("sync_runs"), 1);
  });

  it("chỉ động tới các khóa cảnh báo, không đụng trạng thái khác", () => {
    addState("khac:gi-do", 999);
    pruneHistory(db, 90, NOW);
    assert.equal(count("app_state"), 1);
  });

  it("dryRun đếm đúng nhưng không xóa", () => {
    [1, 100, 200].forEach(addRun);
    assert.equal(pruneHistory(db, 90, NOW, true).prunedRuns, 2);
    assert.equal(count("sync_runs"), 3);
  });

  it("describeCleanup: không có gì thì null, có thì một dòng dễ đọc", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logs-test-"));
    try {
      const none = runMaintenance(db, { logDir: dir, logKeepDays: 7, historyKeepDays: 90, now: NOW });
      assert.equal(describeCleanup(none), null);

      addRun(200);
      const file = path.join(dir, "sync-2026-01-01.log");
      fs.writeFileSync(file, "x".repeat(2048));
      fs.utimesSync(file, new Date(NOW.getTime() - 100 * DAY), new Date(NOW.getTime() - 100 * DAY));

      const done = runMaintenance(db, { logDir: dir, logKeepDays: 7, historyKeepDays: 90, now: NOW });
      assert.equal(describeCleanup(done), "Dọn dẹp: đã xóa 1 file log cũ (2.0 KB), 1 bản ghi lịch sử chạy.");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
