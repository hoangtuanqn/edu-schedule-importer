// Tạo userscripts/fap-import.local.user.js = bản userscript đã điền sẵn IMPORT_TOKEN từ .env.
// File .local.user.js bị .gitignore chặn nên token không bị commit.
//
// Chạy:  npm run userscript:build   (script npm tự nạp .env bằng `node --env-file=.env`)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = path.join(root, "userscripts", "fap-import.user.js");
const output = path.join(root, "userscripts", "fap-import.local.user.js");
const PLACEHOLDER = "PASTE_IMPORT_TOKEN_HERE";

const token = process.env.IMPORT_TOKEN?.trim();
if (!token) {
  console.error("Thiếu IMPORT_TOKEN trong file .env.");
  console.error('Tạo mã bằng: node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'hex\'))"');
  console.error("rồi điền vào dòng IMPORT_TOKEN= trong .env.");
  process.exit(1);
}

const source = fs.readFileSync(template, "utf8");
if (!source.includes(PLACEHOLDER)) {
  console.error(`Không tìm thấy "${PLACEHOLDER}" trong ${path.relative(root, template)}.`);
  process.exit(1);
}

fs.writeFileSync(output, source.replace(PLACEHOLDER, token));
const version = source.match(/@version\s+(\S+)/)?.[1] ?? "?";
console.log(`Đã tạo ${path.relative(root, output)} (userscript bản ${version}, đã điền sẵn token).`);
console.log("Mở file này, copy toàn bộ nội dung và dán vào Tampermonkey (Dashboard → dấu +).");
