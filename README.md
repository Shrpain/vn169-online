# VN169 Online — chạy tool 24/7 miễn phí

Repo này đóng gói toàn bộ tool `vn169` + web dashboard để deploy online:

```
.
├── vn169/              # tool gốc (watcher, DropAPI, bot Telegram, login)
├── vn169-web/          # backend Express + dashboard UI
├── render.yaml         # blueprint deploy Render (free)
├── Dockerfile          # cho Koyeb/Fly/VPS/Hugging Face Spaces
└── docs/keepalive.yml  # mẫu workflow ping giữ Render không sleep
```

---

## 1. Deploy Render (free, ~3 phút)

1. Bấm link blueprint:

   **https://render.com/deploy?repo=https://github.com/Shrpain/vn169-online**

2. Đăng nhập Render bằng GitHub → **Apply**.
3. Chờ build (~2–4 phút). Render tạo service `vn169-control` với URL dạng:

   `https://vn169-control.onrender.com`

4. Vào **Dashboard → service → Environment**, copy giá trị `ADMIN_TOKEN` (Render tự generate).
5. Mở URL, bấm **Token**, dán `ADMIN_TOKEN`.

> Render free spin down sau 15 phút không có request. Workflow keep-alive trong repo sẽ ping mỗi 10 phút — xem mục 3.

---

## 2. Cấu hình lần đầu

1. Tab **Cấu hình**: nhập `API ID`, `API Hash`, số điện thoại Telegram, tài khoản/mật khẩu game, bot token → **Lưu**.
2. Tab **Đăng nhập**: **Bắt đầu đăng nhập** → nhập mã OTP / 2FA → Enter.
3. Tab **Cấu hình → Session để chạy cloud**: **Xuất session** → **Copy JSON**.
4. Vào Render **Environment**, thêm các biến:

   | Key | Value |
   |---|---|
   | `TELEGRAM_API_ID` | API ID |
   | `TELEGRAM_API_HASH` | API Hash |
   | `TELEGRAM_PHONE` | số điện thoại |
   | `TELEGRAM_SESSION` | chuỗi session (nút **Copy session**) |
   | `DROP_USERNAME` | tài khoản game |
   | `DROP_PASSWORD` | mật khẩu game |
   | `BOT_TOKEN` | token bot Telegram |

5. Render tự restart. `AUTO_START=1` sẽ tự bật watcher sau khi khởi động.
6. Tab **Tổng quan** kiểm tra trạng thái `RUNNING`.

> Vì filesystem Render free là tạm, các biến env ở trên giúp session/cấu hình không mất khi restart. Không có chúng, mỗi lần restart phải đăng nhập lại.

---

## 3. Giữ Render không sleep (free)

Render free spin down sau 15 phút không request → watcher dừng. Có 2 cách:

### Cách A: cron-job.org / UptimeRobot (dễ nhất)

1. Tạo monitor HTTP GET tới `https://vn169-control.onrender.com/api/health`.
2. Interval 5–10 phút.
3. Bật monitor.

### Cách B: GitHub Actions

1. Trên GitHub, vào **Add file → Create new file**, tạo `.github/workflows/keepalive.yml` và dán nội dung file `docs/keepalive.yml`.
2. Vào **Settings → Secrets and variables → Actions → Variables**, tạo `APP_URL` = URL Render.
3. Workflow chạy mỗi 10 phút, gọi `/api/health`.

Lưu ý:
- GitHub Actions cron có thể trễ vài phút; nếu Render đã sleep, request đầu tiên sẽ đánh thức (cold start 30–60s).
- Scheduled workflow có thể bị tắt sau 60 ngày repo không hoạt động; vào **Actions → Keep Render awake → Run workflow** để bật lại.
- Render free có 750 giờ/tháng; chạy 24/7 ≈ 730 giờ → vừa đủ 1 service.

---

## 4. Nối UI Vercel (tuỳ chọn)

Nếu muốn dashboard riêng trên Vercel:

1. Sửa `vn169-web/public/config.js`:
   ```js
   window.VN169_API_BASE = "https://vn169-control.onrender.com";
   ```
2. Deploy thư mục UI:
   ```bash
   mkdir vn169-ui
   cp vn169-web/public/{index.html,app.js,style.css,config.js} vn169-ui/
   cd vn169-ui && npx vercel deploy --prod
   ```

Hoặc dùng thẳng URL Render cho cả UI + API (đơn giản hơn, không cần Vercel).

---

## 5. Chạy bằng Docker (Koyeb / Fly / VPS / HF Spaces)

```bash
docker build -t vn169-online .
docker run -d -p 3000:3000 \
  -e ADMIN_TOKEN='chuoi-bi-mat' \
  -e TELEGRAM_API_ID=... \
  -e TELEGRAM_API_HASH=... \
  -e TELEGRAM_PHONE=... \
  -e TELEGRAM_SESSION=... \
  -e DROP_USERNAME=... \
  -e DROP_PASSWORD=... \
  -e BOT_TOKEN=... \
  vn169-online
```

Mở `http://localhost:3000`.

Với nền tảng container khác, set `PORT` theo yêu cầu (mặc định 3000), `HOST=0.0.0.0`, `WATCHER_DIR=/app/vn169`, `AUTO_START=1`.

---

## 6. Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3000` | Cổng |
| `HOST` | `127.0.0.1` | Bind address; cloud dùng `0.0.0.0` |
| `ADMIN_TOKEN` | rỗng | Token dashboard/API (bắt buộc khi public) |
| `WATCHER_DIR` | `../vn169` | Đường dẫn tool |
| `AUTO_START` | `0` | `1` = tự start watcher khi server khởi động |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / `TELEGRAM_PHONE` / `TELEGRAM_SESSION` | — | Cấu hình + session Telegram |
| `DROP_USERNAME` / `DROP_PASSWORD` | — | Tài khoản game |
| `BOT_TOKEN` | — | Token bot Telegram |
| `BET_STEPS` | `1-2-4-8-16` | Dãy hệ số |
| `TARGET_DAY_PROFIT` / `TARGET_HOUR_PROFIT` | `299000` / `30000` | Mục tiêu lãi |
| `DAY_LOSS_LIMIT` / `HOUR_LOSS_LIMIT` | `100000` / `10000` | Giới hạn lỗ |

Thứ tự ưu tiên: **env > `watcher_state.json` > mặc định**.

---

## 7. Bảo mật & pháp lý

- Luôn đặt `ADMIN_TOKEN` mạnh; dashboard có quyền start/stop/đổi cấu hình.
- `TELEGRAM_SESSION`, mật khẩu game, bot token là thông tin nhạy cảm. Chỉ lưu trong env của nền tảng, không commit.
- Không public repo kèm file runtime (`telegram_session.txt`, `telegram_config.json`, `bot.txt`, `dropai_auth.json`).
- Tool điều khiển cá cược tiền thật. Tự chịu rủi ro mất tiền, vi phạm điều khoản nền tảng và quy định pháp luật địa phương.

---

## 8. Xử lý sự cố

| Lỗi | Cách xử lý |
|---|---|
| `Chua co Telegram session` | Đăng nhập qua tab Đăng nhập, hoặc set `TELEGRAM_SESSION` |
| Service sleep, watcher dừng | Bật keep-alive workflow + set `APP_URL` |
| `Conflict (409)` bot | Có instance khác poll cùng bot token; dừng instance cũ |
| Build fail `npm ci` | Xoá `package-lock.json` không khớp hoặc dùng `npm install` trong `buildCommand` |
| Số dư lỗi auth | Kiểm tra `DROP_USERNAME`/`DROP_PASSWORD`, hoặc login lại game |
| Mất session sau restart | Set `TELEGRAM_SESSION` + `TELEGRAM_API_*` vào env |
