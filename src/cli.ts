import type { OAuth2Client } from "./config/google.js";
import { closeDb } from "./db/connection.js";
import { loginInteractive } from "./modules/auth/auth.cli.js";
import { getAuthorizedClient, logout } from "./modules/auth/auth.service.js";
import { formatFapReport } from "./modules/fap/fap.report.js";
import { reconcile as reconcileFap } from "./modules/fap/fap.service.js";
import { formatReport } from "./modules/lms/lms.report.js";
import { syncNow } from "./modules/lms/lms.service.js";

const isAuthError = (e: unknown) => /invalid_grant|invalid_client|\b401\b/.test(String((e as Error)?.message));

async function main(): Promise<number> {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Bắt đầu đồng bộ LMS + FAP → Google Calendar${dryRun ? " (chạy thử)" : ""}...`);

  let auth: OAuth2Client = (await getAuthorizedClient()) ?? (await loginInteractive());

  /** Chạy `fn`; nếu phiên Google hết hạn thì đăng nhập lại một lần rồi chạy lại */
  const withAuth = async <T>(fn: (a: OAuth2Client) => Promise<T>): Promise<T> => {
    try {
      return await fn(auth);
    } catch (e) {
      if (!isAuthError(e)) throw e;
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
    console.error(`FAP THẤT BẠI: ${e instanceof Error ? e.message : e}`);
    failed = true;
  }

  return failed ? 1 : 0;
}

main()
  .then((code) => {
    closeDb();
    process.exit(code);
  })
  .catch((e) => {
    console.error(`\nTHẤT BẠI: ${e instanceof Error ? e.message : e}`);
    if ((e as { details?: unknown })?.details) console.error(JSON.stringify((e as { details: unknown }).details));
    closeDb();
    process.exit(1);
  });
