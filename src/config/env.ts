import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Thiếu biến môi trường ${name} trong file .env`);
  return v;
}

const port = Number(process.env.PORT ?? 3000);

export const env = {
  port,
  googleClientId: required("GOOGLE_CLIENT_ID"),
  googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? `http://localhost:${port}/auth/google/callback`,
  smtp: {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    to: process.env.NOTIFY_TO || process.env.SMTP_USER || undefined,
  },
  importToken: process.env.IMPORT_TOKEN || undefined,
  dbPath: process.env.DB_PATH ?? "data/app.db",
  lmsIcalUrl: process.env.LMS_ICAL_URL,
  tokenPath: process.env.TOKEN_PATH ?? "token.json",
};
