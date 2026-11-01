import { createHash } from "node:crypto";
import path from "node:path";
import { env } from "./config/env.js";
import type { OAuth2Client } from "./config/google.js";
import { closeDb, getDb } from "./db/connection.js";
import { loginInteractive } from "./modules/auth/auth.cli.js";
import { getAuthorizedClient, logout } from "./modules/auth/auth.service.js";
import { formatFapReport } from "./modules/fap/fap.report.js";
import { reconcile as reconcileFap } from "./modules/fap/fap.service.js";
import { formatReport } from "./modules/lms/lms.report.js";
import { syncNow } from "./modules/lms/lms.service.js";
import { describeCleanup, runMaintenance } from "./maintenance/cleanup.js";
import { alertOnce } from "./modules/notify/alert.js";
import type { NotificationMessage } from "./modules/notify/notify.types.js";

/**
 * Cờ dòng lệnh:
 *   --dry-run          chỉ xem trước, không ghi lên Google, không gửi email
 *   --non-interactive  dành cho job chạy ngầm (Task Scheduler): KHÔNG mở trình duyệt để đăng nhập;
 *                      gặp sự cố thì gửi email cảnh báo (tối đa 1 lần/24 giờ/sự cố) và thoát với mã lỗi
 *
 * Mã thoát: 0 = ổn · 1 = có lỗi · 2 = cần đăng nhập lại Google
 */
const dryRun = process.argv.includes("--dry-run");
const nonInteractive = process.argv.includes("--non-interactive");

const isAuthError = (e: unknown) => /invalid_grant|invalid_client|\b401\b/.test(String((e as Error)?.message));

/** Phiên Google không còn hợp lệ và đang ở chế độ chạy ngầm nên không thể tự đăng nhập */
class NeedLoginError extends Error {}

const stamp = () => new Date().toLocaleString("sv-SE"); // 2026-11-01 19:50:00

async function main(): Promise<number> {
  console.log(`[${stamp()}] Bắt đầu đồng bộ LMS + FAP → Google Calendar${dryRun ? " (chạy thử)" : ""}${nonInteractive ? " [chạy ngầm]" : ""}...`);

  const login = async (reason: string): Promise<OAuth2Client> => {
    if (nonInteractive) throw new NeedLoginError(reason);
    return loginInteractive();
  };

  let auth: OAuth2Client = (await getAuthorizedClient()) ?? (await login("Chưa đăng nhập Google (không có token.json)."));

  /** Chạy `fn`; nếu phiên Google hết hạn thì đăng nhập lại một lần (chỉ khi có người ngồi máy) rồi chạy lại */
  const withAuth = async <T>(fn: (a: OAuth2Client) => Promise<T>): Promise<T> => {
    try {
      return await fn(auth);
    } catch (e) {
      if (!isAuthError(e)) throw e;
      if (nonInteractive) throw new NeedLoginError(`Phiên đăng nhập Google đã hết hạn: ${(e as Error).message}`);
      console.log("Phiên đăng nhập Google đã hết hạn, đăng nhập lại...");
      await logout();
      auth = await loginInteractive();
      return fn(auth);
    }
  };

  // 1. LMS: hạn nộp bài
  const lms = await withAuth((a) => syncNow(a, dryRun));
  console.log(formatReport(lms));
  let failed = lms.errors.length > 0;

  // 2. FAP: không lấy được trực tiếp (Cloudflare), lịch được userscript gửi vào DB khi bạn mở FAP.
  //    Ở đây chỉ đối chiếu lại các buổi đã lưu: khôi phục sự kiện bị xóa, cập nhật khi đổi cấu hình.
  try {
    const fap = await withAuth((a) => reconcileFap(a, dryRun));
    if (fap.created.length + fap.updated.length + fap.restored.length + fap.unchanged + fap.errors.length > 0) {
      console.log(formatFapReport(fap));
    } else {
      console.log("FAP: chưa có lịch học/lịch thi nào được lưu (mở trang FAP khi server đang chạy để userscript gửi lịch vào).");
    }
    if (fap.errors.length) failed = true;
  } catch (e) {
    if (e instanceof NeedLoginError) throw e; // lỗi đăng nhập là lỗi chung, không phải riêng FAP
    console.error(`FAP THẤT BẠI: ${e instanceof Error ? e.message : e}`);
    failed = true;
  }

  console.log(`[${stamp()}] Xong${failed ? " (có lỗi)" : ""}.`);
  return failed ? 1 : 0;
}

/** Dọn log và lịch sử cũ cho nhẹ máy. Lỗi ở đây không được làm hỏng lần đồng bộ nên chỉ ghi nhận rồi bỏ qua. */
function tidy() {
  if (dryRun) return; // xem trước thì không xóa gì
  try {
    const line = describeCleanup(
      runMaintenance(getDb(), {
        logDir: path.join(process.cwd(), "logs"),
        logKeepDays: env.logRetentionDays,
        historyKeepDays: env.historyRetentionDays,
      }),
    );
    if (line) console.log(line);
  } catch (e) {
    console.error(`Dọn dẹp lỗi (bỏ qua): ${e instanceof Error ? e.message : e}`);
  }
}

/** Job chạy ngầm bị hỏng thì không ai thấy terminal, nên báo qua email (không lặp lại quá 1 lần/24 giờ) */
async function alertFailure(e: unknown): Promise<number> {
  const reason = e instanceof Error ? e.message : String(e);
  const needLogin = e instanceof NeedLoginError;

  const message: NotificationMessage = needLogin
    ? {
        subject: "[Đồng bộ lịch] Cần đăng nhập lại Google",
        title: "Đồng bộ lịch tự động đang dừng",
        intro: "Job chạy ngầm không thể đồng bộ vì phiên đăng nhập Google không còn hợp lệ.",
        sections: [
          { heading: "Cần làm", tone: "danger", items: ["Mở terminal tại thư mục dự án và chạy: npm start", "Trình duyệt sẽ mở để bạn đăng nhập lại Google; sau đó job tự chạy trở lại bình thường."] },
          { heading: "Nếu tuần nào cũng gặp", tone: "info", items: ["Ứng dụng OAuth ở chế độ Testing bị Google thu hồi quyền sau 7 ngày. Vào Google Cloud Console → OAuth consent screen → Publish app để hết giới hạn này."] },
          { heading: "Chi tiết", tone: "info", items: [reason] },
        ],
        footer: `Lúc ${stamp()}`,
      }
    : {
        subject: "[Đồng bộ lịch] Lỗi khi tự chạy",
        title: "Đồng bộ lịch tự động gặp lỗi",
        intro: "Job chạy ngầm không hoàn thành được.",
        sections: [{ heading: "Chi tiết lỗi", tone: "danger", items: [reason] }],
        footer: `Lúc ${stamp()} · Xem thêm trong logs/sync.log`,
      };

  const key = needLogin ? "google-login" : `failure:${createHash("sha1").update(reason).digest("hex").slice(0, 10)}`;
  try {
    const { status } = await alertOnce(getDb(), key, message);
    const text = {
      sent: "đã gửi email cảnh báo",
      cooldown: "đã cảnh báo trong 24 giờ qua nên không gửi lại",
      "no-channel": "chưa bật kênh email (điền SMTP_USER, SMTP_PASS trong .env) nên không báo được",
      failed: "gửi email cảnh báo THẤT BẠI",
    }[status];
    console.error(`Cảnh báo: ${text}.`);
  } catch (err) {
    console.error(`Không gửi được cảnh báo: ${err instanceof Error ? err.message : err}`);
  }
  return needLogin ? 2 : 1;
}

main()
  .then((code) => {
    tidy();
    closeDb();
    process.exit(code);
  })
  .catch(async (e) => {
    console.error(`\n[${stamp()}] THẤT BẠI: ${e instanceof Error ? e.message : e}`);
    if ((e as { details?: unknown })?.details) console.error(JSON.stringify((e as { details: unknown }).details));
    const code = nonInteractive ? await alertFailure(e) : 1;
    tidy();
    closeDb();
    process.exit(code);
  });
