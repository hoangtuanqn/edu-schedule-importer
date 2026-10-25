import type { OAuth2Client } from "./config/google.js";
import { loginInteractive } from "./modules/auth/auth.cli.js";
import { getAuthorizedClient, logout } from "./modules/auth/auth.service.js";
import { formatReport } from "./modules/lms/lms.report.js";
import { closeDb, syncNow } from "./modules/lms/lms.service.js";

const isAuthError = (e: unknown) => /invalid_grant|invalid_client|\b401\b/.test(String((e as Error)?.message));

async function main(): Promise<number> {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Bắt đầu đồng bộ LMS → Google Calendar${dryRun ? " (chạy thử)" : ""}...`);

  let auth: OAuth2Client | null = await getAuthorizedClient();
  if (!auth) auth = await loginInteractive();

  let report;
  try {
    report = await syncNow(auth, dryRun);
  } catch (e) {
    if (!isAuthError(e)) throw e;
    console.log("Phiên đăng nhập Google đã hết hạn, đăng nhập lại...");
    await logout();
    report = await syncNow(await loginInteractive(), dryRun);
  }

  console.log(formatReport(report));
  return report.errors.length ? 1 : 0;
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
