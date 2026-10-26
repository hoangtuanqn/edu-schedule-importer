import { env } from "../config/env.js";
import { openDb, type Db } from "./database.js";

let db: Db | undefined;

/** Một kết nối SQLite dùng chung cho cả tiến trình */
export const getDb = () => (db ??= openDb(env.dbPath));

export function closeDb() {
  db?.close();
  db = undefined;
}
