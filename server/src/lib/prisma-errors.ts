import { AppError } from "./errors.js";

type PrismaLikeError = {
  code?: unknown;
  meta?: { target?: unknown; constraint?: unknown };
  message?: string;
};

function isPrismaLikeError(error: unknown): error is PrismaLikeError {
  return error !== null && typeof error === "object" && "code" in error;
}

export function isConfirmedSlotConflict(error: unknown): boolean {
  if (!isPrismaLikeError(error) || error.code !== "P2002") return false;

  const target = error.meta?.target;
  const constraint = error.meta?.constraint;
  return (
    constraint === "bookings_one_confirmed_per_slot" ||
    target === "bookings_one_confirmed_per_slot" ||
    (Array.isArray(target) &&
      target.length === 1 &&
      target[0] === "slot_id")
  );
}

export function mapPrismaError(error: unknown): AppError | undefined {
  if (!isPrismaLikeError(error)) return undefined;
  if (error.code === "P2025") return new AppError(404, "booking not found");
  if (isConfirmedSlotConflict(error)) {
    return new AppError(409, "slot already booked");
  }
  return undefined;
}
