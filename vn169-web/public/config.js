// Cấu hình backend mặc định cho dashboard.
// - Cùng origin (server.js phục vụ luôn UI): để chuỗi rỗng "".
// - UI tách riêng (Vercel) + backend Render/VPS: điền URL backend, ví dụ:
//   window.VN169_API_BASE = "https://vn169-control.onrender.com";
// Người dùng vẫn có thể đổi URL backend ngay trên UI (nút "Token" → modal "Kết nối backend");
// giá trị nhập tay được lưu trong localStorage và ưu tiên hơn file này.
window.VN169_API_BASE = "";
