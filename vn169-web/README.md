# VN169 Control — Web Dashboard

Web app quản lý tool theo dõi Telegram + đặt cược DropAI (`vn169`): start/stop/restart watcher, xem trạng thái, số dư, lãi ngày/giờ, cấu hình, đăng nhập Telegram bằng OTP/2FA trên trình duyệt, chỉnh dãy hệ số và giới hạn, xem log real-time.

> ⚠️ **Cảnh báo**: đây là tool điều khiển cá cược tiền thật. Chỉ dùng khi bạn hiểu rõ rủi ro mất tiền, vi phạm điều khoản nền tảng và quy định pháp luật địa phương. Không dùng cho mục đích trái phép.

---

## 1. Thành phần

```
vn169-web/
├── server.js          # Express: quản lý process watcher, login, API, SSE log
├── package.json
├── public/
│   ├── index.html
│   ├── app.js
│   └── style.css
└── README.md

vn169/                 # repo tool gốc (cùng cấp hoặc trỏ qua WATCHER_DIR)
├── watch_group_messages.js
├── dropai_client.js
├── telegram_bot_client.js
├── telegram_login.js  # script đăng nhập Telegram cho web
└── ...
```

Web app **không** chứa logic cược; nó chạy `watch_group_messages.js` như child process và đọc/ghi các file runtime (`telegram_session.txt`, `telegram_config.json`, `bot.txt`, `watcher_state.json`).

---

## 2. Yêu cầu

- Node.js **18+** (khuyến nghị 20+)
- Đã cài dependencies cho repo tool: `cd vn169 && npm install`
- Có `api_id` / `api_hash` / số điện thoại Telegram (lấy tại https://my.telegram.org)
- Tài khoản game + bot token (nếu muốn dùng bot Telegram)

---

## 3. Chạy local

```bash
# 1. Cài dependencies cho web
cd vn169-web
npm install

# 2. Trỏ tới repo tool nếu không nằm cạnh thư mục web
export WATCHER_DIR=/duong/dan/toi/vn169

# 3. (Khuyến nghị) đặt token quản trị
export ADMIN_TOKEN='mot-chuoi-bi-mat-dai'

# 4. Chạy
npm start
```

Mở: **http://127.0.0.1:3000**

### Lần đầu sử dụng

1. Tab **Cấu hình**: nhập `API ID`, `API Hash`, số điện thoại, tài khoản/mật khẩu game, bot token → **Lưu cấu hình**.
2. Tab **Đăng nhập**: bấm **Bắt đầu đăng nhập** → nhập mã xác minh Telegram (và 2FA nếu có) vào ô bên dưới → Enter.
   Telegram thường gửi mã vào **app Telegram** (chat “Telegram”), không phải SMS. Nếu không thấy, bật **Gửi mã qua SMS** rồi Huỷ và Bắt đầu lại.
3. Khi log báo `Dang nhap thanh cong`, session đã lưu vào `vn169/telegram_session.txt`.
4. Tab **Tổng quan**: bấm **Start**.

> Nếu không muốn đăng nhập qua web, có thể chạy `node watch_group_messages.js` một lần trong thư mục `vn169` để tạo session bằng CLI, sau đó web dùng lại session đó.

---

## 4. Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3000` | Cổng web |
| `HOST` | `127.0.0.1` | Địa chỉ bind. Dùng `0.0.0.0` khi deploy |
| `ADMIN_TOKEN` | rỗng | Nếu đặt, mọi API yêu cầu header `x-admin-token` (hoặc `?token=` cho SSE). **Bắt buộc khi public internet** |
| `WATCHER_DIR` | `../vn169` | Đường dẫn repo tool |
| `BET_STEPS` | `1-2-4-8-16` | Override dãy hệ số |
| `TARGET_DAY_PROFIT` | `299000` | Mục tiêu lãi ngày |
| `TARGET_HOUR_PROFIT` | `30000` | Mục tiêu lãi giờ |
| `DAY_LOSS_LIMIT` | `100000` | Giới hạn lỗ ngày |
| `HOUR_LOSS_LIMIT` | `10000` | Giới hạn lỗ giờ |

Thứ tự ưu tiên: **env > `watcher_state.json` > mặc định**.

---

## 5. API

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/health` | Health check (không cần token) |
| GET | `/api/status` | Trạng thái watcher + state + config (đã mask) |
| POST | `/api/config` | Lưu Telegram/Drop/bot config |
| POST | `/api/settings` | Lưu dãy hệ số + giới hạn (áp dụng sau restart) |
| POST | `/api/start` | Start watcher |
| POST | `/api/stop` | Stop watcher |
| POST | `/api/restart` | Restart watcher |
| POST | `/api/login/start` | Bắt đầu đăng nhập Telegram |
| POST | `/api/login/input` | Gửi OTP/2FA `{ text }` |
| POST | `/api/login/cancel` | Huỷ đăng nhập |
| GET | `/api/logs?limit=300` | Log gần đây |
| GET | `/api/logs/stream` | SSE log real-time |
| GET | `/api/balance` | Lấy số dư qua `dropai_client.js` |

---

## 6. Deploy lấy link public

### Cách khuyến nghị: VPS + PM2 + Nginx + HTTPS

Vì watcher là process chạy dài và cần giữ session, **VPS** là lựa chọn ổn định nhất.

```bash
# trên VPS (Ubuntu)
sudo apt update && sudo apt install -y nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# copy 2 thư mục vn169 và vn169-web lên /opt/
cd /opt/vn169 && npm install
cd /opt/vn169-web && npm install

sudo npm i -g pm2
cd /opt/vn169-web
ADMIN_TOKEN='chuoi-bi-mat' HOST=127.0.0.1 PORT=3000 WATCHER_DIR=/opt/vn169 pm2 start server.js --name vn169-web
pm2 save && pm2 startup
```

Cấu hình Nginx (`/etc/nginx/sites-available/vn169`):

```nginx
server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # SSE
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/vn169 /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

→ Link: `https://your-domain.com`

### Cách nhanh: Render / Railway / Fly.io

- Tạo service từ repo, build command: `npm install`, start command: `npm start`.
- Đặt env: `HOST=0.0.0.0`, `ADMIN_TOKEN=...`, `WATCHER_DIR=/opt/render/project/src/vn169` (tùy nền tảng).
- **Lưu ý**: free tier thường sleep/restart, watcher có thể dừng giữa chừng; ổ đĩa có thể không persistent → session/state mất sau redeploy. Dùng paid + persistent disk nếu cần chạy 24/7.

### Không phù hợp: Vercel / Netlify Functions

Serverless không giữ process dài, không chạy được child process watcher và SSE ổn định. Chỉ dùng nếu bạn tách watcher ra nơi khác và web chỉ làm UI.

### Deploy UI lên Vercel (khuyến nghị: UI trên Vercel + backend trên VPS/Render)

Vercel chỉ host phần giao diện tĩnh. Backend `server.js` (quản lý watcher, login, SSE) phải chạy trên máy giữ process 24/7.

1. Chạy backend ở nơi khác (VPS/Render/Railway) và mở port public, ví dụ `https://api.example.com`.
2. Sửa `public/config.js`:

   ```js
   window.VN169_API_BASE = "https://api.example.com";
   ```

3. Tạo thư mục UI và deploy:

   ```bash
   mkdir vn169-ui
   cp public/index.html public/app.js public/style.css public/config.js vn169-ui/
   cd vn169-ui
   npx vercel deploy --prod
   ```

4. Vercel trả về link dạng `https://<project>.vercel.app`.

Lưu ý:
- Backend đã bật CORS (`cors()`), nên UI khác origin gọi được.
- SSE có thể bị proxy buffer; dashboard đã có fallback polling log mỗi 3s.
- Khi đổi backend URL, chỉ cần sửa `config.js` và redeploy UI.
- **Không** deploy `server.js` lên Vercel: `spawn`, ghi file session/state và process watcher dài hạn sẽ không hoạt động.

---

## 7. Bảo mật

- **Luôn đặt `ADMIN_TOKEN`** khi public. Không có token = ai cũng start/stop/đổi cấu hình được.
- Dùng **HTTPS** (Nginx + Certbot, hoặc reverse proxy của nền tảng).
- File nhạy cảm nằm trong `WATCHER_DIR`: `telegram_session.txt`, `telegram_config.json`, `bot.txt`, `dropai_auth.json`, `watcher_state.json`. Không commit, không chia sẻ, không để web root public trực tiếp.
- Mật khẩu game hiện lưu plaintext trong `telegram_config.json` (theo thiết kế tool gốc). Hãy giới hạn quyền file: `chmod 600`.
- Dashboard không trả mật khẩu/token về client; chỉ trả username, phone đã mask, và cờ `has*`.

---

## 8. Xử lý sự cố

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| `Chua co Telegram session` | Chưa đăng nhập. Vào tab Đăng nhập hoặc chạy CLI một lần. |
| Login treo, không thấy prompt | Kiểm tra log nguồn `login`; đảm bảo đã lưu api_id/hash/phone trước khi bấm bắt đầu. |
| Không nhận được mã xác minh | Telegram gửi mã vào **app Telegram** (chat “Telegram”) thay vì SMS. Mở Telegram trên thiết bị khác để lấy. Nếu vẫn không có: bật **Gửi mã qua SMS**, Huỷ rồi Bắt đầu lại. Kiểm tra số đúng định dạng `+84...`, api_id/api_hash đúng, và chờ nếu bị `FLOOD_WAIT`. |
| Mã báo `PHONE_CODE_INVALID` | Nhập sai mã; nhập lại ngay trên ô input (không cần bấm Bắt đầu lại). |
| Mã hết hạn (`PHONE_CODE_EXPIRED`) | Bấm Huỷ rồi Bắt đầu lại để nhận mã mới. |
| `API_ID_INVALID` | api_id/api_hash sai hoặc dùng api_id của app khác; lấy lại tại my.telegram.org. |
| `PHONE_NUMBER_INVALID` | Số sai/thiếu mã quốc gia; nhập dạng `+8490xxxxxxx`. |
| `FLOOD_WAIT` | Telegram giới hạn gửi mã; chờ 5–10 phút rồi thử lại, tránh bấm liên tục. |
| `Conflict (409)` ở bot | Có instance bot khác đang poll cùng token. Dừng instance cũ; kiểm tra `bot_poll.lock`. |
| Start báo thiếu file | Sai `WATCHER_DIR`; kiểm tra `GET /api/health` trả về đường dẫn đúng. |
| Log real-time không chạy | Reverse proxy đang buffer SSE; bật `proxy_buffering off`. |
| Số dư lỗi `auth unavailable` | Chưa có `dropai_auth.json` hoặc sai tài khoản game; kiểm tra tab Cấu hình. |
| Đổi cài đặt không có hiệu lực | Cài đặt chỉ áp dụng sau **Restart** watcher. |

---

## 9. Ghi chú thiết kế

- `server.js` chỉ quản lý process và file; mọi logic cược vẫn nằm trong repo `vn169` để tránh lệch hành vi.
- Web đọc `watcher_state.json` để hiển thị lãi/giờ, pause, limits; không tự tính toán lại.
- `/api/balance` chạy một script Node ngắn trong `WATCHER_DIR` để dùng đúng `dropai_client.js` và token cache.
- Login web dùng `telegram_login.js` (readline + stdin), cho phép nhập OTP/2FA từ trình duyệt.
- SSE giữ kết nối để log real-time; có heartbeat 25s và tự reconnect.

---

## 10. Không có link tự động

AI tạo mã nguồn này không thể host và cấp link public thay bạn. Sau khi deploy theo mục 6, bạn sẽ có link riêng (ví dụ `https://your-domain.com`).
