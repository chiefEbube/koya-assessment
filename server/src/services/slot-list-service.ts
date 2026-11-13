import { prisma } from "../lib/prisma.js";
import { serializeSlot } from "../lib/serialize.js";

export async function listSlots(provider: string | undefined) {
  const rows = await prisma.slot.findMany({
    where: {
      ...(provider === undefined ? {} : { provider }),
    },
    orderBy: [{ start: "asc" }, { id: "asc" }],
    include: {
      booking: {
        where: { status: "confirmed" },
        select: { id: true },
      },
    },
  });
  return {
    slots: rows.map(({ booking, ...slot }) =>
      serializeSlot(slot, booking.length === 0)
    ),
  };
}
