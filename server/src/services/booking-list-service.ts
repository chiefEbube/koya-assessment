import { prisma } from "../lib/prisma.js";
import { decodeCursor, encodeCursor } from "../lib/cursor.js";
import { serializeBooking } from "../lib/serialize.js";

export async function listBookings(
  email: string,
  limit: number,
  cursorValue?: string,
  status?: "confirmed" | "cancelled"
) {
  const cursor = decodeCursor(cursorValue);
  const rows = await prisma.booking.findMany({
    where: {
      email: { equals: email, mode: "insensitive" },
      ...(status ? { status } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { gt: cursor.createdAt } },
              {
                createdAt: cursor.createdAt,
                id: { gt: cursor.id },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    bookings: page.map(serializeBooking),
    next_cursor: hasMore && last
      ? encodeCursor({ createdAt: last.createdAt, id: last.id })
      : null,
  };
}
