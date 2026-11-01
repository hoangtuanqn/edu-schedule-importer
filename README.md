# Edu Schedule Importer

Tự động đưa **hạn nộp bài (LMS)** và **lịch học, lịch thi (FAP)** lên **Google Calendar**, kèm lời nhắc, và gửi **email** mỗi khi có thay đổi.

- Chạy hoàn toàn trên máy của bạn. Không có máy chủ nào khác, dữ liệu nằm trong một file SQLite.
- Viết bằng TypeScript + Express. Đã có 81 test.

> Dự án làm cho hệ thống của FPT (LMS Moodle và FAP). Với trường khác thì phần LMS (đọc iCal của Moodle) dùng lại được, phần FAP cần sửa bộ đọc trang.

## Mục lục

1. [Nó làm gì](#1-nó-làm-gì)
2. [Cài đặt từ đầu](#2-cài-đặt-từ-đầu)
3. [Cấu hình môn học và lịch Google](#3-cấu-hình-môn-học-và-lịch-google)
4. [Chạy lần đầu](#4-chạy-lần-đầu)
5. [Lịch FAP: cài userscript](#5-lịch-fap-cài-userscript)
6. [Tự chạy định kỳ](#6-tự-chạy-định-kỳ)
7. [Email thông báo](#7-email-thông-báo)
8. [Quy tắc đồng bộ](#8-quy-tắc-đồng-bộ)
9. [Danh sách lệnh](#9-danh-sách-lệnh)
10. [Xử lý sự cố](#10-xử-lý-sự-cố)
11. [Bảo mật](#11-bảo-mật)
12. [Cấu trúc mã nguồn](#12-cấu-trúc-mã-nguồn)
13. [Mở rộng](#13-mở-rộng)
14. [Hạn chế đã biết](#14-hạn-chế-đã-biết)

---

## 1. Nó làm gì

```
 LMS (Moodle)  ── link iCal ───────────────┐
                                           ├─►  SQLite  ─►  Google Calendar
 FAP ── userscript trong trình duyệt ──────┘   (data/app.db)   + lời nhắc popup
        (vì FAP bị Cloudflare chặn)                │
                                                   └─►  Email khi có thay đổi
```

| Nguồn | Lấy gì | Tự động thế nào |
|---|---|---|
| **LMS** | Hạn nộp bài, đóng bài kiểm tra | Tự chạy theo giờ (mặc định mỗi 2 giờ) |
| **FAP** | Lịch học, lịch thi, lớp online (kèm link Meet), phòng, giảng viên | Tự cập nhật mỗi khi bạn vào FAP trong trình duyệt |

Tính năng chính:

- **Không tạo trùng.** Chạy bao nhiêu lần cũng được, mỗi sự kiện có ID cố định.
- **Tự khôi phục.** Lỡ xóa một sự kiện trên Google thì lần chạy sau tạo lại (nếu hạn trong 10 ngày gần đây hoặc tương lai).
- **Theo dõi thay đổi.** Hạn nộp đổi giờ, phòng đổi, lịch thi mới... đều được cập nhật lên Google và báo qua email, ghi rõ *cũ → mới*.
- **Phân biệt lịch thi.** Lịch thi có tiền tố `[Thi]`, màu đỏ và lời nhắc riêng.
- **Lời nhắc popup** do chính Google Calendar bắn (1 tuần, 3 ngày, 1 ngày, 5 giờ trước hạn nộp...), không phải email.

---

## 2. Cài đặt từ đầu

### 2.1. Yêu cầu

| Thứ cần | Ghi chú |
|---|---|
| **Node.js 22.13 trở lên** | Dự án dùng `node:sqlite` có sẵn trong Node, không cần cài thêm gói SQLite |
| Tài khoản **Google** | Có Google Calendar |
| **Chrome** + tiện ích **Tampermonkey** | Chỉ cần cho phần FAP |
| Tài khoản Gmail để gửi mail | Tùy chọn. Không có thì chỉ mất tính năng email |
| **Windows** | Chỉ cần cho phần tự chạy định kỳ (xem mục 6 nếu dùng macOS/Linux) |

### 2.2. Tải mã và cài thư viện

```bash
git clone https://github.com/<tên-bạn>/edu-schedule-importer.git
cd edu-schedule-importer
npm install
```

### 2.3. Tạo file `.env`

```bash
copy .env.example .env      # Windows
# cp .env.example .env      # macOS / Linux
```

Mở `.env` và điền dần theo các bước dưới. Bảng đầy đủ các biến:

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Có | Lấy ở bước 2.4 |
| `GOOGLE_REDIRECT_URI` | Không | Mặc định `http://localhost:3000/auth/google/callback`. Phải khớp với Google Cloud |
| `PORT` | Không | Cổng server, mặc định `3000` |
| `LMS_ICAL_URL` | Có (cho LMS) | Link iCal của LMS, lấy ở bước 2.5 |
| `IMPORT_TOKEN` | Có (cho FAP) | Mã bí mật cho userscript, tạo ở bước 2.7 |
| `SMTP_USER`, `SMTP_PASS`, `NOTIFY_TO` | Không | Gửi email, bước 2.6 |
| `SMTP_HOST`, `SMTP_PORT` | Không | Mặc định `smtp.gmail.com` và `465` |
| `DB_PATH` | Không | Mặc định `data/app.db` |
| `TOKEN_PATH` | Không | Nơi lưu đăng nhập Google, mặc định `token.json` |
| `LOG_RETENTION_DAYS` | Không | Xóa file log không được ghi trong ngần này ngày. Mặc định `7`, `0` là không xóa (mục 6.4) |
| `HISTORY_RETENTION_DAYS` | Không | Xóa lịch sử các lần chạy trong DB cũ hơn ngần này ngày. Mặc định `90`, `0` là không xóa |

### 2.4. Lấy thông tin đăng nhập Google (làm một lần)

1. Vào [Google Cloud Console](https://console.cloud.google.com) và **tạo một project** mới.
2. **APIs & Services → Library**, tìm **Google Calendar API** và bấm **Enable**.
3. **APIs & Services → OAuth consent screen**: chọn loại **External**, điền tên ứng dụng và email của bạn. Ở mục **Test users**, thêm chính Gmail của bạn.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:3000/auth/google/callback`
5. Copy **Client ID** và **Client secret** vào `.env`.
6. **Quan trọng, nên làm ngay:** quay lại **OAuth consent screen** và bấm **Publish app**.
   Nếu ứng dụng còn ở chế độ *Testing*, Google thu hồi đăng nhập sau **7 ngày** và việc tự chạy sẽ dừng. Khi đăng nhập, Google có thể hiện cảnh báo "ứng dụng chưa được xác minh": chọn **Advanced → Go to ... (unsafe)**. Đó là ứng dụng của chính bạn nên an toàn.

### 2.5. Lấy link iCal của LMS

1. Vào LMS, mở **Calendar** (Lịch), chọn **Export calendar** (Xuất lịch).
2. **Events to export**: *All*. **Time period**: *Custom range*.
3. Bấm **Get calendar URL** và copy vào `LMS_ICAL_URL` trong `.env`.

Link này đã chứa mã truy cập riêng nên không cần đăng nhập. **Hãy coi nó như mật khẩu.** Nếu bạn bấm tạo link mới trên LMS thì link cũ hỏng và phải cập nhật lại `.env`.

Ghi chú: *Custom range* của LMS cho dữ liệu từ khoảng 5 ngày trước đến khoảng 365 ngày sau hôm nay (do LMS quy định, không đổi được).

### 2.6. Gửi email (tùy chọn)

Với Gmail:

1. Bật **Xác minh 2 bước** cho tài khoản Gmail dùng để gửi.
2. Vào [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) và tạo **Mật khẩu ứng dụng** (16 ký tự).
3. Điền `.env`:
   ```
   SMTP_USER=gmail-gui@gmail.com
   SMTP_PASS=mat-khau-ung-dung-16-ky-tu
   NOTIFY_TO=gmail-nhan@gmail.com
   ```
   `NOTIFY_TO` bỏ trống thì gửi cho chính `SMTP_USER`. Để trống `SMTP_PASS` là tắt email.

### 2.7. Tạo mã bí mật cho FAP

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Dán kết quả vào `IMPORT_TOKEN=` trong `.env`.

---

## 3. Cấu hình môn học và lịch Google

Mọi thứ nằm trong `config/courses.json`. File được đọc lại **mỗi lần chạy**, sửa xong không cần khởi động lại.

```json
{
  "courses": ["MAD101", "PRO192", "OSG202"],
  "calendar": "Nhắc nhở",
  "eventDurationMinutes": 30,
  "timeZone": "Asia/Ho_Chi_Minh",
  "eventColor": "",
  "reminderMinutes": [10080, 4320, 1440, 300],
  "fap": {
    "ignoreCourses": []
  }
}
```

| Khóa | Ý nghĩa |
|---|---|
| `courses` | **Chỉ áp dụng cho LMS.** Mã các môn muốn lấy hạn nộp bài (không phân biệt hoa thường). Mỗi kỳ học đổi danh sách này. Môn cũ không cần lấy thì không ghi |
| `calendar` | Lịch Google chứa hạn nộp bài LMS. Ghi **tên lịch** (khớp một phần, không phân biệt hoa thường: `"Nhắc nhở"` khớp lịch `"❗ Nhắc nhở"`), hoặc id lịch, hoặc `"primary"` cho lịch chính |
| `eventDurationMinutes` | LMS chỉ cho một mốc giờ (hạn nộp). Sự kiện trên Google dài bấy nhiêu phút và **kết thúc đúng giờ hạn** |
| `timeZone` | Múi giờ của sự kiện |
| `eventColor` | Màu riêng của sự kiện LMS. Một trong `lavender` `sage` `grape` `flamingo` `banana` `tangerine` `peacock` `graphite` `blueberry` `basil` `tomato`. Để `""` thì sự kiện lấy màu của lịch chứa nó |
| `reminderMinutes` | Báo trước **hạn nộp** bao nhiêu phút (popup của Google). Tối đa 5 mốc, mỗi mốc tối đa 40320 phút (4 tuần). Mặc định: 1 tuần, 3 ngày, 1 ngày, 5 giờ |
| `fap.ignoreCourses` | Môn muốn **bỏ qua** khi lấy từ FAP. FAP lấy **tất cả** môn trong lịch của bạn, nên mặc định để trống |

Khối `fap` còn có các tùy chọn sau (đều có mặc định, chỉ thêm vào khi muốn đổi):

| Khóa trong `fap` | Mặc định | Ý nghĩa |
|---|---|---|
| `calendar` | `"Học tập ở ngoài"` | Lịch Google chứa lịch học và lịch thi. **Đổi cho đúng lịch của bạn** |
| `classColor` | `""` | Màu lịch học |
| `examColor` | `"tomato"` | Màu lịch thi (đỏ) |
| `classReminderMinutes` | `[60]` | Nhắc trước giờ bắt đầu buổi học |
| `examReminderMinutes` | `[4320, 1440, 180]` | Nhắc trước lịch thi: 3 ngày, 1 ngày, 3 giờ |

> **Lịch Google phải tồn tại sẵn.** Hệ thống không tự tạo lịch. Nếu tên lịch không khớp lịch nào (hoặc khớp nhiều lịch), nó báo lỗi kèm danh sách lịch bạn có thể ghi.

---

## 4. Chạy lần đầu

Chạy thử trước để xem nó định làm gì, **không ghi gì lên Google và không gửi email**:

```bash
npm start -- --dry-run
```

Lần đầu chưa đăng nhập nên trình duyệt tự mở trang đăng nhập Google. Đăng nhập, cho phép truy cập Calendar, rồi quay lại terminal. Đăng nhập được lưu trong `token.json`.

Thấy báo cáo hợp lý thì chạy thật:

```bash
npm start
```

Báo cáo in ra terminal cho biết: thêm mới, cập nhật, khôi phục, không đổi, lỗi. Nếu có thay đổi và đã bật email, một thư tóm tắt được gửi đi.

---

## 5. Lịch FAP: cài userscript

FAP được bảo vệ bởi Cloudflare nên chương trình không thể tự truy cập từ bên ngoài. Giải pháp: một **userscript** chạy ngay trong trình duyệt của bạn (đã đăng nhập FAP), lấy lịch rồi gửi về server trên máy bạn.

```
Trình duyệt (đã đăng nhập FAP)
   └─ userscript lấy ~20 tuần ─► POST http://127.0.0.1:3000/api/fap/import ─► SQLite ─► Google Calendar ─► email
```

### 5.1. Cài đặt một lần

1. Cài tiện ích **Tampermonkey** cho Chrome.
2. Vào `chrome://extensions`, bấm **Details** của Tampermonkey và bật **Allow User Scripts** (Chrome bản mới yêu cầu, thiếu thì userscript không chạy và không báo gì).
3. Tạo bản userscript đã điền sẵn mã bí mật:
   ```bash
   npm run userscript:build
   ```
   Lệnh này đọc `IMPORT_TOKEN` trong `.env` và ghi ra `userscripts/fap-import.local.user.js`. File này bị `.gitignore` chặn nên mã không bị đưa lên git.
4. Mở Tampermonkey → **Dashboard** → dấu **+**, xóa nội dung mẫu, dán **toàn bộ** nội dung `userscripts/fap-import.local.user.js`, bấm **Ctrl+S**.
5. Nếu sửa `IMPORT_TOKEN` hoặc cập nhật mã, chạy lại `npm run userscript:build` và dán đè.

### 5.2. Dùng hằng ngày

1. Bật server: `npm run dev` (để cửa sổ đó chạy).
2. Vào **bất kỳ trang nào** của `fap.fpt.edu.vn`. Không cần mở trang lịch tuần.
3. Góc dưới bên phải trang hiện thông báo tiến độ, rồi kết quả, ví dụ:
   `FAP 21 tuần (2026-10-18 → 2027-03-07): +5 mới, 2 thay đổi · 40 không đổi · đã gửi email`

Lần đầu Tampermonkey hỏi quyền kết nối tới `127.0.0.1`: chọn **Always allow**.

Cách script chạy:

| | |
|---|---|
| Khoảng quét | Từ 2 tuần trước đến 4 tháng sau hôm nay, gọi từng tuần qua `/WeeklyTimetable/WeekPartial?referenceDate=<Chủ nhật của tuần>` |
| Tần suất | Vào FAP nhiều lần thì chỉ quét lại sau mỗi **3 giờ**. Lỗi thì thử lại sau 10 phút |
| Menu Tampermonkey | **Chạy thử lịch FAP** (xem trước, không ghi gì) và **Đồng bộ lịch FAP ngay** (bỏ qua giới hạn 3 giờ) |

Nên bấm **Chạy thử** ở lần đầu tiên để xem trước kết quả.

### 5.3. Điều cần nhớ

- Lịch FAP chỉ cập nhật khi **bạn vào FAP** và **server đang chạy**. Phần tự chạy ngầm ở mục 6 chỉ đối chiếu lại những buổi đã lưu (khôi phục buổi bạn lỡ xóa trên Google), không tự lấy lịch mới.
- Tuần nào FAP chưa công bố thì chưa có. Khi FAP công bố, lần vào sau sẽ lấy được.
- Các buổi học đã quá 10 ngày không được đẩy lên Google (chỉ lưu trong DB).

---

## 6. Tự chạy định kỳ

### 6.1. Windows (đã có sẵn công cụ)

```bash
npm run schedule:install     # cài job: chạy sau 1 phút, rồi lặp mỗi 2 giờ
npm run schedule:status      # xem lần chạy gần nhất, lần kế tiếp và 15 dòng cuối của log
npm run schedule:run         # chạy ngay một lần và hiện kết quả
npm run schedule:remove      # gỡ job
```

Đổi nhịp (ví dụ 4 giờ): `powershell -File scripts/schedule.ps1 -Action install -EveryHours 4`. Chạy lại `install` sẽ **ghi đè** job cũ.

Job chạy `npm start -- --non-interactive`, tức là đồng bộ LMS và đối chiếu lại các buổi FAP đã lưu.

**Khi tắt máy rồi bật lại:**

- Mốc nào rơi vào lúc máy tắt sẽ **không** chạy lúc đó.
- Khi bạn bật máy và **đăng nhập Windows**, job chạy bù **một lần** ngay, rồi quay về nhịp thường.
- Job chỉ chạy khi bạn đã đăng nhập Windows (không lưu mật khẩu). Máy ngủ không tự thức dậy để chạy.
- Không chạy chồng nhau; quá 30 phút thì tự dừng.

Log mỗi ngày một file: `logs/sync-YYYY-MM-DD.log`. Log cũ tự bị xóa, xem mục 6.4.

### 6.2. Chế độ chạy ngầm `--non-interactive`

Dành cho việc tự chạy: **không bao giờ mở trình duyệt**. Khi gặp sự cố (cần đăng nhập lại Google, link LMS hỏng...), nó gửi email cảnh báo, **tối đa một lần mỗi 24 giờ cho mỗi loại sự cố**, nên không spam hộp thư.

| Mã thoát | Nghĩa |
|---|---|
| `0` | Ổn |
| `1` | Có lỗi (xem log) |
| `2` | Cần đăng nhập lại Google: chạy `npm start` rồi đăng nhập |

### 6.3. macOS / Linux

Dùng cron, ví dụ chạy mỗi 2 giờ (`crontab -e`):

```
0 */2 * * * cd /đường/dẫn/dự/án && mkdir -p logs && npm start -- --non-interactive >> logs/sync-$(date +\%F).log 2>&1
```

(Trong crontab dấu `%` phải viết là `\%`. Việc dọn log cũ vẫn tự chạy sau mỗi lần `npm start`.)

### 6.4. Tự dọn log cho nhẹ máy

Sau **mỗi lần** `npm start`, chương trình tự dọn:

| Dọn gì | Khi nào xóa | Chỉnh trong `.env` |
|---|---|---|
| File log `logs/sync*.log` | Không được ghi trong **7 ngày** | `LOG_RETENTION_DAYS` |
| Lịch sử các lần chạy trong DB (bảng `sync_runs`) | Cũ hơn **90 ngày** | `HISTORY_RETENTION_DAYS` |
| Trạng thái chống lặp cảnh báo đã hết hạn | Cũ hơn 30 ngày | (cố định) |

Đặt giá trị `0` là **không xóa**. Giá trị không hợp lệ (chữ, số âm) thì dùng mặc định.

Cách tính: dựa vào lần ghi cuối của file, nên file của ngày hôm nay (đang được ghi) không bao giờ bị xóa. Chỉ file tên dạng `sync*.log` trong thư mục `logs/` mới bị đụng tới; file khác bạn tự để vào đó thì giữ nguyên. Lần chạy nào có dọn thì dòng cuối log ghi, ví dụ: `Dọn dẹp: đã xóa 3 file log cũ (7.5 KB).`

Muốn dọn ngay hoặc xem trước:

```bash
npm run cleanup -- --dry-run    # chỉ liệt kê những gì sẽ xóa
npm run cleanup                 # dọn thật
```

`npm start -- --dry-run` thì không xóa gì.

---

## 7. Email thông báo

Chỉ gửi khi **có biến động thật**: sự kiện mới, thay đổi, bị hủy, được khôi phục, hoặc lỗi. Không đổi gì thì không gửi. Cập nhật thuần do bạn đổi cấu hình (màu, lời nhắc) cũng không gửi.

Tiêu đề nêu điều quan trọng nhất lên đầu. Ví dụ:

```
[LMS] Đổi hạn nộp: PRO192 Assignment is due - 23:00 Th 7, 31/10 → 23:00 Th 2, 02/11
[LMS] 1 bị xóa · 1 đổi hạn · 2 mới - OSG202, PRO192
[FAP] Lịch thi mới: [Thi] MAD101 - AI2101 - 14:30 Th 6, 20/11 · Phòng 111
[FAP] 2 thay đổi - MAD101
```

Nội dung xếp theo mức quan trọng (lỗi, bị xóa, thay đổi, mới, khôi phục). Với mỗi thay đổi, giá trị cũ bị gạch và giá trị mới in đậm. Mỗi mục liệt kê tối đa 25 dòng, phần còn lại ghi "và N mục khác" (lần nhập đầu cho 4 tháng có thể có hàng trăm buổi).

---

## 8. Quy tắc đồng bộ

### 8.1. LMS (hạn nộp bài)

- Mỗi hạn nộp thành một sự kiện dài `eventDurationMinutes` phút, kết thúc đúng giờ hạn. Tiêu đề: `[PRO192] Assignment is due`.
- Chỉ lấy môn nằm trong `courses`. Môn nhận ra từ mã đầu của tên lớp trên LMS (ví dụ `PRO192-KiemHH` → `PRO192`).
- Lời nhắc tính từ **hạn nộp** (đã trừ thời lượng sự kiện), nên "5 giờ" là đúng 5 giờ trước hạn.
- LMS xóa một sự kiện thì hệ thống chỉ **ghi vào báo cáo**, không tự xóa trên Google (để bạn tự quyết).

### 8.2. FAP (lịch học và lịch thi)

- Lấy **tất cả** môn trong lịch (trừ `fap.ignoreCourses`).
- Lịch thi nhận ra nhờ nhãn "Lịch thi" trên FAP: tiền tố `[Thi]`, màu đỏ, nhắc 3 ngày, 1 ngày, 3 giờ.
- Lớp online: địa điểm của sự kiện là **link Meet**, bấm vào là vào lớp. Link cũng nằm trong mô tả.
- Mô tả mỗi sự kiện có: loại lịch, lớp, giờ, slot, hình thức (online/offline), phòng, giảng viên. Phòng hoặc giảng viên `-` trên FAP thì ghi "(chưa có)".
- Đổi **giờ, phòng, giảng viên, hình thức, link Meet** thì sự kiện trên Google được cập nhật.
- **Trạng thái điểm danh bị bỏ qua** (nó đổi liên tục và sẽ gây cập nhật vô nghĩa).
- Buổi biến mất khỏi một tuần đã nhập (bị hủy hoặc dời) được báo trong email, nhưng sự kiện cũ trên Google **không tự bị xóa**.

### 8.3. Chung cho cả hai

- **Không tạo trùng:** mỗi sự kiện có ID cố định (`lms<id>` và `fap<hash>`). Chạy lại thì cập nhật chứ không tạo thêm.
- **Khôi phục sự kiện bị xóa:** nếu hạn trong 10 ngày gần đây hoặc ở tương lai. Cũ hơn thì để yên.
  Lưu ý kỹ thuật: Google giữ lại bản "đã xóa" mang cùng ID và **không cho khôi phục** qua API, nên hệ thống tạo lại bằng ID kế tiếp (`...r1`, `...r2`) và nhớ ID đó trong DB.
- **Đổi tên lịch trong `calendar`:** sự kiện đã tạo được **chuyển** sang lịch mới, không tạo bản sao.

---

## 9. Danh sách lệnh

| Lệnh | Việc |
|---|---|
| `npm start` | Đồng bộ LMS + đối chiếu FAP một lần, in báo cáo. Mở trình duyệt nếu cần đăng nhập |
| `npm start -- --dry-run` | Như trên nhưng chỉ xem trước: không ghi lên Google, không gửi email |
| `npm start -- --non-interactive` | Dành cho tự chạy: không mở trình duyệt, gửi cảnh báo khi hỏng |
| `npm run dev` | Bật server, tự khởi động lại khi sửa code (dùng khi cần FAP) |
| `npm run server` | Bật server, không tự khởi động lại |
| `npm run userscript:build` | Tạo userscript FAP đã điền sẵn token |
| `npm run schedule:install` / `status` / `run` / `remove` | Quản lý job tự chạy trên Windows |
| `npm test` | Chạy toàn bộ test (81 test) |
| `npm run cleanup` | Dọn log và lịch sử cũ ngay (`-- --dry-run` để xem trước) |
| `npm run build` | Biên dịch TypeScript sang `dist/` |

### API của server

Server chỉ lắng nghe trên `127.0.0.1` (máy bạn), không mở ra mạng LAN.

| Method | Đường dẫn | Việc |
|---|---|---|
| GET | `/health` | Kiểm tra server sống |
| GET | `/auth/google` | Bắt đầu đăng nhập Google |
| GET | `/auth/status` | Đã đăng nhập chưa |
| POST | `/auth/logout` | Xóa đăng nhập |
| GET | `/api/lms/config` | Xem cấu hình đang dùng |
| GET | `/api/lms/events` | Xem trước sự kiện LMS đã lọc |
| POST | `/api/lms/sync` | Đồng bộ LMS (`?dryRun=true` để chạy thử) |
| POST | `/api/fap/import` | Nhận lịch từ userscript. Cần header `x-import-token`. Body `{ "weeks": [{ "html": "...", "referenceDate": "YYYY-MM-DD" }] }` |
| GET/POST/PATCH/DELETE | `/api/events[/:id]` | Thêm, sửa, xóa sự kiện Google Calendar tùy ý |

---

## 10. Xử lý sự cố

| Hiện tượng | Nguyên nhân và cách xử lý |
|---|---|
| Userscript không hiện thông báo gì | Chưa bật **Allow User Scripts** cho Tampermonkey (xem 5.1), hoặc script đang tắt. Thanh công cụ Tampermonkey có số `1` trên trang FAP là script đã gắn vào |
| "Không kết nối được server" | Server chưa chạy. Chạy `npm run dev` rồi tải lại trang FAP |
| "Server trả lỗi 401: Sai IMPORT_TOKEN" | Userscript dán sai bản hoặc token cũ. Chạy `npm run userscript:build` và dán lại; nhớ khởi động lại server sau khi sửa `.env` |
| "Server trả lỗi 400" | Server đang chạy bản code cũ. Tắt (`Ctrl+C`) và bật lại |
| "FAP không trả về bảng lịch" | Chưa đăng nhập FAP, hoặc phiên đã hết hạn. Đăng nhập lại FAP |
| Một môn thiếu trên lịch FAP | Kiểm tra `fap.ignoreCourses` có chứa môn đó không. Thông báo trên trang FAP có ghi các môn bị bỏ qua |
| Thiếu hạn nộp của một môn LMS | Môn đó chưa nằm trong `courses`. Báo cáo ghi "Môn có trên LMS nhưng không theo dõi" |
| "Không tìm thấy lịch ..." | Tên trong `calendar` hoặc `fap.calendar` không khớp lịch Google nào. Thông báo lỗi liệt kê các lịch hợp lệ |
| Email báo "Cần đăng nhập lại Google" | Đăng nhập hết hạn (thường do chưa **Publish app**, mục 2.4). Chạy `npm start` và đăng nhập lại |
| Email báo lỗi LMS | Link iCal bị đổi hoặc bị chặn. Lấy link mới (mục 2.5) |
| "Cổng 3000 đang được dùng" | Có tiến trình khác chiếm cổng, hoặc server cũ chưa tắt. Đổi `PORT` trong `.env` (và redirect URI trong Google Cloud, cùng `SERVER` trong userscript) |
| Job tự chạy không chạy | `npm run schedule:status` xem lần gần nhất và mã kết quả. Nhớ rằng nó chỉ chạy khi bạn đã đăng nhập Windows |
| Xem chi tiết một lần chạy ngầm | Mở `logs/sync-<ngày>.log` của ngày đó (`npm run schedule:status` in sẵn 15 dòng cuối). Log chỉ giữ 7 ngày |

---

## 11. Bảo mật

Các file sau chứa thông tin nhạy cảm và đã được `.gitignore` chặn, **không bao giờ commit**:

| File | Chứa |
|---|---|
| `.env` | Client secret Google, link LMS, mật khẩu email, mã bí mật |
| `token.json` | Đăng nhập Google của bạn |
| `data/` | Cơ sở dữ liệu (lịch, tên giảng viên...) |
| `userscripts/*.local.user.js` | Userscript đã điền token |
| `logs/`, `samples/` | Log và dữ liệu mẫu |

Ngoài ra:

- Server chỉ nhận kết nối từ máy bạn (`127.0.0.1`), và endpoint nhận lịch FAP cần `IMPORT_TOKEN`.
- Link iCal của LMS **là mật khẩu**: ai có link xem được lịch của bạn.
- Đừng dán cookie đăng nhập (FAP, LMS) vào bất kỳ đâu, kể cả khi nhờ người khác giúp. Nếu lỡ dán, hãy **đăng xuất** để vô hiệu hóa chúng.
- Repo công khai thì kiểm tra kỹ trước khi push. File mẫu trong `src/modules/fap/__fixtures__` đã được ẩn tên giảng viên.

---

## 12. Cấu trúc mã nguồn

```
config/courses.json            cấu hình môn học, lịch, màu, lời nhắc
scripts/                       cài job tự chạy (Windows) và tạo userscript
userscripts/fap-import.user.js userscript chạy trong trình duyệt cho FAP
src/
├─ cli.ts                      lệnh `npm start`
├─ server.ts, app.ts           server Express
├─ config/                     đọc .env, tạo OAuth client Google
├─ db/                         SQLite: schema, kết nối, migration
├─ maintenance/                dọn log và lịch sử cũ (tự chạy sau mỗi `npm start`)
├─ middlewares/                xử lý lỗi, kiểm tra dữ liệu vào
├─ test-utils/fakeGoogle.ts    Google giả (mô phỏng cả bản "đã xóa") dùng cho test
└─ modules/
   ├─ auth/                    đăng nhập Google, lưu token
   ├─ events/                  thao tác với Google Calendar, cầu nối `calendar.gateway`
   ├─ lms/                     đọc iCal, đồng bộ hạn nộp bài, báo cáo, email
   ├─ fap/                     đọc bảng lịch tuần, đồng bộ lịch học/thi, báo cáo, email
   └─ notify/                  gửi thông báo dùng chung (kênh email), cảnh báo chống lặp
```

Mỗi module chia theo `*.routes` / `*.controller` / `*.service` / `*.repository` / `*.test`.

**Cơ sở dữ liệu** (`data/app.db`, SQLite):

| Bảng | Lưu |
|---|---|
| `lms_events` | Các hạn nộp bài đã thấy và trạng thái đồng bộ |
| `fap_sessions` | Các buổi học/thi từ FAP và trạng thái đồng bộ |
| `sync_runs` | Lịch sử các lần chạy (tự xóa sau 90 ngày) |
| `app_state` | Trạng thái lặt vặt (lần cảnh báo gần nhất) |

Bảng tự được tạo và nâng cấp khi chạy.

---

## 13. Mở rộng

- **Thêm kênh thông báo** (Telegram, Discord...): viết một đối tượng có `isEnabled()` và `send(message)` trong `src/modules/notify/channels/`, rồi thêm vào mảng `channels` ở `notify.service.ts`. Các module khác không phải sửa.
- **Thêm nguồn dữ liệu mới:** tạo module trong `src/modules/`, dùng lại `calendar.gateway` để ghi lên Google và `notify()` để báo. Có thể tham khảo `fap/` làm mẫu.
- **Tạo thông báo riêng:** truyền một `NotificationMessage` (tiêu đề, các mục, màu) cho `notify()`; mỗi kênh tự trình bày.

Trước khi sửa, chạy `npm test`. Test dùng Google giả nên không đụng lịch thật của bạn.

---

## 14. Hạn chế đã biết

- **FAP phải đi qua trình duyệt:** chỉ cập nhật khi bạn vào FAP và server đang chạy.
- **Tự chạy chỉ có sẵn cho Windows.** Hệ điều hành khác dùng cron (mục 6.3).
- **Lỗi từng sự kiện lặp lại:** nếu một sự kiện cứ lỗi mỗi lần, email báo lỗi của lần đồng bộ sẽ lặp theo nhịp chạy. Chống lặp mới áp dụng cho lỗi toàn job.
- **Giảng viên** hiển thị theo tên đăng nhập mà FAP cung cấp (ví dụ `abcd12`), không phải họ tên đầy đủ.
- **Phụ thuộc vào cấu trúc trang FAP** và endpoint `WeekPartial`. Nếu FAP đổi giao diện, userscript sẽ báo lỗi rõ ràng và cần cập nhật bộ đọc trong `src/modules/fap/fap.parser.ts`.
- `node:sqlite` còn ở mức thử nghiệm trong Node 22. Các script đã tắt dòng cảnh báo; nâng phiên bản Node lớn thì nên chạy lại `npm test`.
