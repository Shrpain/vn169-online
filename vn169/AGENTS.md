# AGENTS.md

## Phạm vi
- Repo này là tool Node.js ESM theo dõi Telegram group và tự động gọi Drop API; entrypoint chính là `watch_group_messages.js`.
- `package.json` chỉ có script `start`/`watch` trỏ đến `node watch_group_messages.js`; không có lint/test/typecheck cấu hình sẵn.
- Không có thư mục `dropAI/` trong checkout hiện tại; đừng dùng hướng dẫn cũ về dự án .NET.

## Đọc Trước Khi Sửa
1. `watch_group_messages.js` - luồng chính: đăng nhập Telegram, đọc group, parse tín hiệu, quản lý chu kỳ cược, gọi bot thông báo.
2. `dropai_client.js` - ký request, login/cache token, balance, issue hiện tại, đặt cược.
3. `telegram_bot_client.js` - bot control `/start`, `/stop`, `/restart`, `/cn`, `/hs`, `/status`, `/sd` và lock polling.
4. `watcher_supervisor.ps1`, `start_watcher_hidden.ps1`, `run_telegram_tool.bat`, `stop_telegram_tool.bat` - cách chạy nền trên Windows.

## Lệnh Thực Tế
- Cài dependency: `npm install`.
- Chạy foreground: `npm start` hoặc `node watch_group_messages.js`.
- Liệt kê group Telegram: `node telegram_groups.js`.
- Chạy nền có supervisor: `powershell -NoProfile -ExecutionPolicy Bypass -File "D:\tooll\start_watcher_hidden.ps1"`.
- Restart theo batch hiện có: `run_telegram_tool.bat`; stop: `stop_telegram_tool.bat`.
- Auto-start Windows tạo Scheduled Task `ToolWatcherBackground`: `powershell -NoProfile -ExecutionPolicy Bypass -File "D:\tooll\install_autostart.ps1"`.

## Trạng Thái Và Bí Mật
- Các file runtime ở root có thể chứa credential/token/session thật: `telegram_session.txt`, `main_account_session.txt`, `telegram_config.json`, `dropai_auth.json`, `bot.txt`, `bot_chat.json`, `watcher_state.json`, `bot_poll.lock`.
- Không copy giá trị từ các file này vào log, tài liệu, commit hoặc test fixture.
- `telegram_session.txt` đang được xử lý theo 2 format: JSON mới `{ session, api_id, api_hash, phone }` trong `watch_group_messages.js`, nhưng `telegram_groups.js` vẫn đọc/ghi chuỗi session thô. Cẩn thận khi dùng script liệt kê group vì có thể ghi đè format.
- `bot_poll.lock` ngăn nhiều bot poll cùng lúc; nếu tool bị kill bất thường, kiểm tra PID trong lock trước khi xóa thủ công.

## Drop API
- Base URL và headers nằm trong `dropai_client.js`; đừng đổi `Origin`/`Referer`/`Ar-Origin` nếu không đang sửa API compatibility.
- Chữ ký nằm ở `createDropSignature(data)`: sort key bằng `Object.keys(data).sort()`, bỏ `signature`, `track`, `xosoBettingData`, `timestamp`, bỏ null/undefined/chuỗi rỗng, string dùng `JSON.stringify`, boolean là `true`/`false`, rồi MD5 uppercase.
- `createSignedBody` tự thêm `random` và `timestamp`; không ký thủ công ở call site.
- Auth cache ở `dropai_auth.json`; `callDropApi` tự retry login một lần nếu token lỗi.

## Logic Theo Dõi/Cược
- Group mục tiêu đang hardcode trong `watch_group_messages.js`: username `vn168wingoo`, id `-1001538393680`, tên `VN168 - WINGO (1 phut)`.
- Regex tín hiệu yêu cầu text có `Hãy đánh ... (NHỎ|LỚN) ... Kỳ xổ hiện tại <số>`; logic normalize dấu chỉ áp dụng cho kết quả thắng/thua, không áp dụng cho regex tín hiệu.
- Bước cược mặc định là `[1, 2, 4, 8, 16]`; logic cược: **THẮNG lần 2 liên tiếp mới lên 1 bậc, THẮNG 3 kỳ liên tiếp tự về bậc 1 (chốt lãi), THUA về bậc 1** (thắng ở bậc cuối thì giữ nguyên); bot command `/cn` thay đổi dãy trong runtime và `/hs` reset mặc định.
- Mỗi đơn vị cược nhân `1000`.
- Giới hạn tự dừng (hardcode trong `watch_group_messages.js`, theo giờ/ngày địa phương): mục tiêu lãi ngày `299000`, mục tiêu lãi giờ `30000`, giới hạn lỗ ngày `100000`, giới hạn lỗ giờ `10000`; chạm giới hạn giờ thì nghỉ `30 phút` rồi tự quay lại, chạm giới hạn ngày thì dừng đến hết ngày (cần `/start` để gỡ sớm hơn).
- Trạng thái pause lưu trong `watcher_state.json`: `pauseReason` (`DAY_TARGET`/`DAY_LOSS`/`HOUR_TARGET`/`HOUR_LOSS`), `pauseUntil`, `dayStartBalance`, `hourStartBalance`, `dayStartedAt`, `hourStartedAt`, `lastLimits`; `/status` và thông báo bot đọc qua callbacks `getDayProfit`/`getHourProfit`/`getPauseReason`/`getPauseUntil`/`getDayTargetProfit`/`getHourTargetProfit`/`getDayLossLimit`/`getHourLossLimit`/`getHourPauseMinutes`.

## Ranh Giới
- `node_modules/` đã nằm trong workspace nhưng không phải mã nguồn cần sửa.
- `logs/` và các file `.json` trạng thái là dữ liệu vận hành; chỉ sửa khi nhiệm vụ trực tiếp liên quan đến runtime state.
- `zalo_client.js` tồn tại nhưng hiện không được import bởi entrypoint chính; đừng giả định Zalo đang chạy trong luồng chính nếu chưa nối lại code.
