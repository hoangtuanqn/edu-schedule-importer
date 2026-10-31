// ==UserScript==
// @name         FAP → Google Calendar
// @namespace    integration-ggcalendar
// @version      2.3.1
// @description  Mỗi lần bạn vào FAP, tự lấy lịch học/lịch thi (2 tuần trước → 4 tháng tới) và gửi tới server trên máy bạn để đồng bộ Google Calendar
// @match        https://fap.fpt.edu.vn/*
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // Server chạy bằng `npm run server` (chỉ lắng nghe trên máy bạn).
  const SERVER = "http://127.0.0.1:3000";
  // Giá trị IMPORT_TOKEN trong file .env
  const TOKEN = "PASTE_IMPORT_TOKEN_HERE";

  const BACK_DAYS = 14; // lấy lại 2 tuần trước để cập nhật thay đổi
  const AHEAD_MONTHS = 4; // và 4 tháng tới
  const MIN_INTERVAL_MS = 3 * 60 * 60 * 1000; // vào FAP nhiều lần thì chỉ quét lại sau mỗi 3 giờ
  const RETRY_AFTER_FAIL_MS = 10 * 60 * 1000; // lỗi (server tắt, chưa đăng nhập...) thì thử lại sau 10 phút
  const STALE_LOCK_MS = 10 * 60 * 1000;
  const FETCH_GAP_MS = 250; // nghỉ giữa các lần gọi FAP để không dồn dập

  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Đưa ngày về Chủ nhật của chính tuần đó (Chủ nhật là ngày cuối tuần: thứ Hai → Chủ nhật; Chủ nhật giữ nguyên) */
  function toSunday(d) {
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); // getDay(): 0 = Chủ nhật
    return d;
  }

  /**
   * Ngày dùng làm referenceDate cho từng tuần: FAP trả đúng tuần khi gọi bằng CHỦ NHẬT cuối tuần
   * (vd 2026-11-08 → tuần 02/11 - 08/11). Đi từ tuần chứa (hôm nay - BACK_DAYS) đến tuần chứa (hôm nay + AHEAD_MONTHS tháng).
   */
  function weekReferenceDates() {
    const start = new Date();
    start.setHours(12, 0, 0, 0); // 12h trưa để không lệch ngày khi đổi giờ
    start.setDate(start.getDate() - BACK_DAYS);
    toSunday(start);

    const end = new Date();
    end.setHours(12, 0, 0, 0);
    end.setMonth(end.getMonth() + AHEAD_MONTHS);
    toSunday(end);

    const out = [];
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) out.push(ymd(d));
    return out;
  }

  // ---------- hiển thị ----------
  const COLORS = { info: "#1d4ed8", ok: "#15803d", error: "#b91c1c" };
  function toast(message, tone, ms) {
    let el = document.getElementById("fap-import-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "fap-import-toast";
      el.style.cssText =
        "position:fixed;right:16px;bottom:16px;z-index:99999;max-width:400px;padding:10px 14px;border-radius:8px;" +
        "font:13px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.3);";
      document.body.appendChild(el);
    }
    el.style.background = COLORS[tone] || COLORS.info;
    el.textContent = message;
    clearTimeout(el._t);
    if (ms) el._t = setTimeout(() => el.remove(), ms);
  }

  function summarize(r) {
    const parts = [
      r.created.length && `+${r.created.length} mới`,
      r.changed.length && `${r.changed.length} thay đổi`,
      r.updated.length && `${r.updated.length} cập nhật`,
      r.restored.length && `${r.restored.length} khôi phục`,
      r.missing.length && `${r.missing.length} không còn trên FAP`,
      r.errors.length && `${r.errors.length} lỗi`,
      r.warnings && r.warnings.length && `${r.warnings.length} cảnh báo (xem Console)`,
    ].filter(Boolean);
    const mail = (r.notifications || []).some((n) => n.ok) ? " · đã gửi email" : "";
    const ignored = r.ignoredCourses && r.ignoredCourses.length ? ` · bỏ qua môn trong fap.ignoreCourses:${r.ignoredCourses.join(", ")}` : "";
    const range = r.range ? `${r.range.weeks} tuần (${r.range.start} → ${r.range.end})` : "";
    return `FAP ${range}: ${parts.length ? parts.join(", ") : "không có gì thay đổi"} · ${r.unchanged} không đổi${mail}${ignored}`;
  }

  // ---------- lấy lịch từ FAP ----------
  /** outerHTML của bảng lịch tuần chứa `date`; null nếu phản hồi không phải bảng lịch (ví dụ trang đăng nhập) */
  async function fetchWeekTable(date) {
    const res = await fetch(`/WeeklyTimetable/WeekPartial?referenceDate=${date}`, {
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (res.status === 401 || res.status === 403) throw new Error("FAP từ chối truy cập (chưa đăng nhập hoặc phiên hết hạn).");
    if (!res.ok) throw new Error(`FAP trả lỗi HTTP ${res.status}.`);
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const table = doc.querySelector("table");
    return table ? table.outerHTML : null;
  }

  // ---------- gửi cho server ----------
  function post(weeks, dryRun) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: SERVER + "/api/fap/import" + (dryRun ? "?dryRun=true" : ""),
        headers: { "Content-Type": "application/json", "x-import-token": TOKEN },
        data: JSON.stringify({ weeks }),
        timeout: 5 * 60 * 1000, // lần đầu tạo hàng trăm sự kiện có thể lâu
        onload(res) {
          let body = {};
          try {
            body = JSON.parse(res.responseText);
          } catch (_) {}
          if (res.status >= 200 && res.status < 300) resolve(body);
          else reject(new Error(`Server trả lỗi ${res.status}: ${body.error || res.responseText.slice(0, 150)}`));
        },
        onerror() {
          reject(new Error("Không kết nối được server. Hãy chạy `npm run server` rồi tải lại trang."));
        },
        ontimeout() {
          reject(new Error("Server không phản hồi (quá 5 phút)."));
        },
      });
    });
  }

  // ---------- điều phối ----------
  /** force: bỏ qua giới hạn thời gian. dryRun: chỉ xem trước, server không ghi gì lên Google và không gửi email */
  async function run(force, dryRun) {
    const now = Date.now();
    if (!force) {
      if (now - Number(GM_getValue("lastOk", 0)) < MIN_INTERVAL_MS) return; // vừa quét xong
      if (now - Number(GM_getValue("lastFail", 0)) < RETRY_AFTER_FAIL_MS) return; // vừa lỗi, đừng làm phiền
    }
    if (now - Number(GM_getValue("running", 0)) < STALE_LOCK_MS) return; // tab khác đang quét
    GM_setValue("running", now);

    try {
      const dates = weekReferenceDates();
      const weeks = [];
      for (let i = 0; i < dates.length; i++) {
        toast(`FAP→Calendar: đang lấy lịch ${i + 1}/${dates.length} tuần…`, "info");
        const html = await fetchWeekTable(dates[i]);
        if (html) weeks.push({ html, referenceDate: dates[i] });
        else if (i === 0) throw new Error("FAP không trả về bảng lịch. Bạn đã đăng nhập FAP chưa?");
        await sleep(FETCH_GAP_MS);
      }
      toast(`FAP→Calendar: đang đồng bộ ${weeks.length} tuần lên Google Calendar…`, "info");
      const report = await post(weeks, dryRun);
      if (!dryRun) GM_setValue("lastOk", Date.now());
      toast((dryRun ? "[CHẠY THỬ - chưa ghi gì] " : "") + summarize(report), report.errors && report.errors.length ? "error" : "ok", 15000);
      console.log("[FAP→GCal] báo cáo:", report);
    } catch (e) {
      if (!dryRun) GM_setValue("lastFail", Date.now());
      toast(`FAP→Calendar: ${e.message}`, "error", 20000);
      console.error("[FAP→GCal]", e);
    } finally {
      GM_setValue("running", 0);
    }
  }

  console.log("[FAP→GCal] userscript đã chạy trên", location.href);
  GM_registerMenuCommand("Chạy thử lịch FAP (xem trước, không ghi gì)", () => run(true, true));
  GM_registerMenuCommand("Đồng bộ lịch FAP ngay (bỏ qua giới hạn 3 giờ)", () => run(true, false));
  run(false);
})();
