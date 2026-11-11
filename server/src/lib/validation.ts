import { z } from "zod";
import { AppError } from "./errors.js";

const dateTimeSchema = z.iso.datetime({ offset: true });

export const resetBodySchema = z.object({
  slots: z.array(
    z.object({
      id: z.string().min(1),
      provider: z.string().min(1),
      start: dateTimeSchema,
      end: dateTimeSchema,
    })
  ),
});

export const bookingBodySchema = z.object({
  slot_id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
});

export type NormalizedBookingBody = z.infer<typeof bookingBodySchema>;

export function parseBookingBody(input: unknown): NormalizedBookingBody {
  const result = bookingBodySchema.safeParse(input);
  if (!result.success) {
    throw new AppError(400, "invalid booking request");
  }
  return result.data;
}

export function normalizeBookingBody(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  const body = input as Record<string, unknown>;
  return {
    slot_id: typeof body.slot_id === "string" ? body.slot_id.trim() : body.slot_id,
    name: typeof body.name === "string" ? body.name.trim() : body.name,
    email:
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : body.email,
  };
}

export function parseResetBody(input: unknown) {
  const result = resetBodySchema.safeParse(input);
  if (!result.success) {
    throw new AppError(400, "invalid request body");
  }
  return result.data.slots.map((slot) => ({
    id: slot.id,
    provider: slot.provider,
    start: new Date(slot.start),
    end: new Date(slot.end),
  }));
}

export function parseProvider(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "string") {
    throw new AppError(400, "invalid provider");
  }
  return input;
}

export function parseBookingsQuery(query: {
  email?: unknown;
  limit?: unknown;
  cursor?: unknown;
}) {
  if (typeof query.email !== "string" || query.email.trim().length === 0) {
    throw new AppError(400, "email is required");
  }

  const rawLimit = query.limit;
  let limit = 10;
  if (rawLimit !== undefined) {
    if (
      typeof rawLimit !== "string" ||
      !/^[0-9]+$/.test(rawLimit)
    ) {
      throw new AppError(400, "invalid limit");
    }
    limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new AppError(400, "invalid limit");
    }
  }

  if (query.cursor !== undefined && typeof query.cursor !== "string") {
    throw new AppError(400, "invalid cursor");
  }

  return {
    email: query.email.trim().toLowerCase(),
    limit,
    cursor: query.cursor as string | undefined,
  };
}
