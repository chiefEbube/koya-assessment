import type { Booking, Slot } from "../generated/prisma/client.js";

export function serializeBooking(booking: Booking) {
  return {
    id: booking.id,
    slot_id: booking.slotId,
    name: booking.name,
    email: booking.email,
    status: booking.status,
    created_at: booking.createdAt.toISOString(),
  };
}

export function serializeSlot(slot: Slot, available: boolean) {
  return {
    id: slot.id,
    provider: slot.provider,
    start: slot.start.toISOString(),
    end: slot.end.toISOString(),
    available,
  };
}
