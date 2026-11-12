import { AppError } from "./errors.js";

export interface BookingCursor {
  createdAt: Date;
  id: string;
}

export interface SlotCursor {
  start: Date;
  id: string;
}

export function encodeCursor(cursor: BookingCursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id })
  ).toString("base64url");
}

export function encodeSlotCursor(cursor: SlotCursor): string {
  return Buffer.from(
    JSON.stringify({ start: cursor.start.toISOString(), id: cursor.id })
  ).toString("base64url");
}

export function decodeCursor(value: string | undefined): BookingCursor | undefined {
  if (value === undefined) return undefined;

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("createdAt" in parsed) ||
      !("id" in parsed) ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0
    ) {
      throw new Error("Invalid cursor shape");
    }
    const createdAt = new Date(parsed.createdAt);
    if (!Number.isFinite(createdAt.getTime())) {
      throw new Error("Invalid cursor timestamp");
    }
    return { createdAt, id: parsed.id };
  } catch {
    throw new AppError(400, "invalid cursor");
  }
}

export function decodeSlotCursor(value: string | undefined): SlotCursor | undefined {
  if (value === undefined) return undefined;

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("start" in parsed) ||
      !("id" in parsed) ||
      typeof parsed.start !== "string" ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0
    ) {
      throw new Error("Invalid cursor shape");
    }
    const start = new Date(parsed.start);
    if (!Number.isFinite(start.getTime())) {
      throw new Error("Invalid cursor timestamp");
    }
    return { start, id: parsed.id };
  } catch {
    throw new AppError(400, "invalid cursor");
  }
}
