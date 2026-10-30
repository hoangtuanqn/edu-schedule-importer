import { createApp } from "./app.js";
import { env } from "./config/env.js";

// Chỉ lắng nghe trên máy này: endpoint nhập lịch FAP không được mở ra mạng LAN
createApp().listen(env.port, "127.0.0.1", () => {
  console.log(`Server chạy tại http://localhost:${env.port}`);
  console.log(`Đăng nhập Google: http://localhost:${env.port}/auth/google`);
});
