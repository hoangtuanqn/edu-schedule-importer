import nodemailer from "nodemailer";
import { env } from "../../../config/env.js";
import { renderHtml, renderText } from "../notify.render.js";
import type { NotificationChannel, NotificationMessage } from "../notify.types.js";

export const emailChannel: NotificationChannel = {
  name: "email",

  isEnabled: () => !!(env.smtp.user && env.smtp.pass && env.smtp.to),

  async send(message: NotificationMessage) {
    const { host, port, user, pass, to } = env.smtp;
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465 = SSL, các cổng khác (587) dùng STARTTLS
      auth: { user, pass },
    });
    try {
      await transport.sendMail({
        from: `"Thông báo" <${user}>`,
        to,
        subject: message.subject,
        text: renderText(message),
        html: renderHtml(message),
      });
    } finally {
      transport.close();
    }
  },
};
