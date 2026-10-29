/** Ngày hôm nay (YYYY-MM-DD) theo múi giờ `tz` */
export function todayIn(tz: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "Th 4", "CN"... */
export function weekdayShort(date: string): string {
  return new Intl.DateTimeFormat("vi-VN", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

/** "09:10 Th 4, 18/11" */
export const whenLabel = (date: string, time: string) =>
  `${time} ${weekdayShort(date)}, ${date.slice(8, 10)}/${date.slice(5, 7)}`;
