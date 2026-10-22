import { z } from "zod";

const time = z
  .object({
    dateTime: z.string().datetime({ offset: true }).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // sự kiện cả ngày
    timeZone: z.string().optional(),
  })
  .refine((v) => v.dateTime || v.date, "Cần dateTime hoặc date");

export const createEventSchema = z.object({
  summary: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  start: time,
  end: time,
  attendees: z.array(z.object({ email: z.string().email() })).optional(),
});

export const updateEventSchema = createEventSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Cần ít nhất một trường để sửa");

export type CreateEventDto = z.infer<typeof createEventSchema>;
export type UpdateEventDto = z.infer<typeof updateEventSchema>;
