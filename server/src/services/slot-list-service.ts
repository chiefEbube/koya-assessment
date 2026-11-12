import { prisma } from "../lib/prisma.js";
import { decodeSlotCursor, encodeSlotCursor } from "../lib/cursor.js";
import { serializeSlot } from "../lib/serialize.js";

export async function listAvailableDoctors() {
  const rows = await prisma.slot.groupBy({
    where: { booking: { none: { status: "confirmed" } } },
    by: ["provider"],
    orderBy: { provider: "asc" },
    _count: { _all: true },
  });
  return {
    doctors: rows.map(({ provider, _count }) => ({
      name: provider,
      available_slots: _count._all,
    })),
  };
}

export async function listSlots(
  provider: string | undefined,
  limit: number,
  cursorValue: string | undefined,
  availableOnly: boolean
) {
  const cursor = decodeSlotCursor(cursorValue);
  const rows = await prisma.slot.findMany({
    where: {
      ...(provider === undefined ? {} : { provider }),
      ...(availableOnly ? { booking: { none: { status: "confirmed" as const } } } : {}),
      ...(cursor
        ? {
            OR: [
              { start: { gt: cursor.start } },
              { start: cursor.start, id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ start: "asc" }, { id: "asc" }],
    take: limit + 1,
    include: {
      booking: {
        where: { status: "confirmed" },
        select: { id: true },
      },
    },
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    slots: page.map(({ booking, ...slot }) =>
      serializeSlot(slot, booking.length === 0)
    ),
    next_cursor: hasMore && last
      ? encodeSlotCursor({ start: last.start, id: last.id })
      : null,
  };
}
