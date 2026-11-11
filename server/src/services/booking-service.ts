import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { acquireAdvisoryLock } from "../lib/advisory-lock.js";
import { AppError } from "../lib/errors.js";
import { hashRequest, storeIdempotencyResponse } from "../lib/idempotency.js";
import { isConfirmedSlotConflict } from "../lib/prisma-errors.js";
import { normalizeBookingBody, parseBookingBody } from "../lib/validation.js";
import { serializeBooking } from "../lib/serialize.js";

type StoredResponse = {
  status: number;
  body: Record<string, unknown>;
  retryAfter?: number;
};

type BookingInput = {
  slot_id: unknown;
  name: unknown;
  email: unknown;
};

async function recordAttempt(
  transaction: Prisma.TransactionClient,
  email: string
): Promise<number | undefined> {
  await acquireAdvisoryLock(transaction, `rate-limit:${email}`);
  const [clock] = await transaction.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  if (!clock) throw new Error("Database clock query returned no result");
  const [window] = await transaction.$queryRaw<
    { count: number; oldest: Date | null }[]
  >`
    SELECT COUNT(*)::int AS count, MIN(attempted_at) AS oldest
    FROM booking_attempts
    WHERE email = ${email}
      AND attempted_at >= ${new Date(clock.now.getTime() - 60_000)}
  `;
  if (!window) throw new Error("Rate-limit query returned no result");

  if (window.count >= 5) {
    const retryAfter = Math.max(
      1,
      Math.ceil(
        ((window.oldest?.getTime() ?? clock.now.getTime()) +
          60_000 -
          clock.now.getTime()) /
          1000
      )
    );
    return retryAfter;
  }

  await transaction.bookingAttempt.create({
    data: { email, attemptedAt: clock.now },
  });
  return undefined;
}

async function createBookingResponse(
  transaction: Prisma.TransactionClient,
  input: BookingInput
): Promise<StoredResponse> {
  let bookingInput;
  try {
    bookingInput = parseBookingBody(input);
  } catch (error) {
    if (error instanceof AppError) {
      return { status: error.statusCode, body: { error: error.message } };
    }
    throw error;
  }

  await acquireAdvisoryLock(transaction, `slot:${bookingInput.slot_id}`);
  const slot = await transaction.slot.findUnique({
    where: { id: bookingInput.slot_id },
  });
  if (!slot) {
    return { status: 404, body: { error: "slot not found" } };
  }
  if (slot.start.getTime() <= Date.now()) {
    return { status: 400, body: { error: "slot has already started" } };
  }

  const existing = await transaction.booking.findFirst({
    where: { slotId: bookingInput.slot_id, status: "confirmed" },
    select: { id: true },
  });
  if (existing) {
    return { status: 409, body: { error: "slot already booked" } };
  }

  const booking = await transaction.booking.create({
    data: {
      slotId: bookingInput.slot_id,
      name: bookingInput.name,
      email: bookingInput.email,
    },
  });
  return { status: 201, body: serializeBooking(booking) };
}

export async function createBooking(input: BookingInput, idempotencyKey?: string) {
  const normalizedBody = normalizeBookingBody(input);
  const requestHash = hashRequest(normalizedBody);
  const normalizedEmail =
    normalizedBody &&
    typeof normalizedBody === "object" &&
    "email" in normalizedBody &&
    typeof normalizedBody.email === "string"
      ? normalizedBody.email
      : "";

  try {
    return await prisma.$transaction(async (transaction) => {
      if (idempotencyKey !== undefined) {
        await acquireAdvisoryLock(transaction, `idempotency:${idempotencyKey}`);
        const existing = await transaction.idempotencyRecord.findUnique({
          where: { key: idempotencyKey },
        });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            return {
              status: 422,
              body: {
                error: "idempotency key reused with different request body",
              },
            } satisfies StoredResponse;
          }
          const storedBody = existing.responseBody as Record<string, unknown>;
          const retryAfter = storedBody.__idempotency_retry_after;
          const body = { ...storedBody };
          delete body.__idempotency_retry_after;
          return {
            status: existing.responseStatus,
            body,
            ...(typeof retryAfter === "number" ? { retryAfter } : {}),
          } satisfies StoredResponse;
        }
      }

      const retryAfter = await recordAttempt(transaction, normalizedEmail);
      const response: StoredResponse =
        retryAfter === undefined
          ? await createBookingResponse(transaction, input)
          : {
              status: 429,
              body: { error: "too many booking attempts" },
              retryAfter,
            };

      if (idempotencyKey !== undefined) {
        const storedBody =
          response.retryAfter === undefined
            ? response.body
            : {
                ...response.body,
                __idempotency_retry_after: response.retryAfter,
              };
        await storeIdempotencyResponse(
          transaction,
          idempotencyKey,
          requestHash,
          response.status,
          storedBody
        );
      }
      return response;
    });
  } catch (error) {
    if (!isConfirmedSlotConflict(error)) throw error;

    const response: StoredResponse = {
      status: 409,
      body: { error: "slot already booked" },
    };
    if (idempotencyKey !== undefined) {
      await prisma.$transaction(async (transaction) => {
        await acquireAdvisoryLock(
          transaction,
          `idempotency:${idempotencyKey}`
        );
        const existing = await transaction.idempotencyRecord.findUnique({
          where: { key: idempotencyKey },
        });
        if (!existing) {
          await storeIdempotencyResponse(
            transaction,
            idempotencyKey,
            requestHash,
            response.status,
            response.body
          );
        }
      });
    }
    return response;
  }
}
