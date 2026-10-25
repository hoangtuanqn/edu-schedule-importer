import { createApp } from "./app.js";
import { env } from "./config/env.js";

createApp().listen(env.port, () => {
  console.log(`Server chạy tại http://localhost:${env.port}`);
  console.log(`Đăng nhập Google: http://localhost:${env.port}/auth/google`);
});
