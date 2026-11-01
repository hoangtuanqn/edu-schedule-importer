import type { calendar_v3 } from "googleapis";
import type { CalendarGateway } from "../modules/events/calendar.gateway.js";
import { upsertVia, type EventsApi } from "../modules/events/events.service.js";

/**
 * Google giả, mô phỏng đúng hành vi thật: xóa sự kiện chỉ để lại bản "cancelled" mang cùng id,
 * và bản đó KHÔNG khôi phục được (insert -> 409, patch -> 403).
 */
export type Store = Map<string, calendar_v3.Schema$Event>;
const err = (code: number) => Object.assign(new Error(`HTTP ${code}`), { code });

export function fakeEventsApi(store: Store, dead: Set<string>, cal: string): EventsApi {
  const key = (id: string) => `${cal}|${id}`;
  return {
    insert: async ({ requestBody }: any) => {
      const id = requestBody.id as string;
      if (store.has(id) || dead.has(key(id))) throw err(409);
      store.set(id, requestBody);
      return { data: requestBody };
    },
    get: async ({ eventId }: any) => {
      if (dead.has(key(eventId))) return { data: { status: "cancelled" } };
      if (store.has(eventId)) return { data: { ...store.get(eventId), status: "confirmed" } };
      throw err(404);
    },
    patch: async ({ eventId, requestBody }: any) => {
      if (dead.has(key(eventId))) throw err(403);
      store.set(eventId, { ...store.get(eventId), ...requestBody });
      return { data: store.get(eventId) };
    },
  } as unknown as EventsApi;
}

export function fakeGoogle(
  calendars: Record<string, Store> = { primary: new Map(), reminders: new Map() },
  target = "reminders",
  dead = new Set<string>(),
) {
  const store = calendars[target]; // lịch đích
  const calls = { upsert: 0, status: 0, move: 0 };
  const api = fakeEventsApi(store, dead, target);
  const gateway: CalendarGateway = {
    calendarId: target,
    async status(id, inCal = target) { calls.status++; return calendars[inCal].has(id) ? "exists" : "deleted"; },
    async upsert(id, body) { calls.upsert++; return (await upsertVia(api, id, body, target)).eventId; },
    async move(id, from) { calls.move++; store.set(id, calendars[from].get(id)!); calendars[from].delete(id); },
  };
  /** Người dùng xóa mọi sự kiện trong lịch đích trên Google (để lại bản cancelled) */
  const wipe = () => { for (const id of store.keys()) dead.add(`${target}|${id}`); store.clear(); };
  return { store, calendars, calls, gateway, wipe, dead };
}
