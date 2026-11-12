import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { serializeBooking } from "../lib/serialize.js";
import {
  parseBookingsQuery,
  parseResetBody,
  parseSlotsQuery,
} from "../lib/validation.js";
import { createBooking } from "../services/booking-service.js";
import { listBookings } from "../services/booking-list-service.js";
import { listAvailableDoctors, listSlots } from "../services/slot-list-service.js";

const router = Router();

router.post("/reset", async (req, res) => {
  const slots = parseResetBody(req.body);
  await prisma.$transaction(async (transaction) => {
    await transaction.booking.deleteMany();
    await transaction.idempotencyRecord.deleteMany();
    await transaction.bookingAttempt.deleteMany();
    await transaction.slot.deleteMany();
    if (slots.length > 0) {
      await transaction.slot.createMany({ data: slots });
    }
  });
  res.status(200).end();
});

router.get("/doctors", async (_req, res) => {
  res.json(await listAvailableDoctors());
});

router.get("/slots", async (req, res) => {
  const query = parseSlotsQuery(req.query);
  res.json(
    await listSlots(
      query.provider,
      query.limit,
      query.cursor,
      query.availableOnly
    )
  );
});

router.get("/bookings", async (req, res) => {
  const query = parseBookingsQuery(req.query);
  res.json(await listBookings(query.email, query.limit, query.cursor));
});

router.post("/bookings", async (req, res) => {
  const idempotencyKey = req.header("Idempotency-Key");
  const response = await createBooking(req.body, idempotencyKey);
  if (response.retryAfter !== undefined) {
    res.setHeader("Retry-After", String(response.retryAfter));
  }
  res.status(response.status).json(response.body);
});

router.get("/bookings/:id", async (req, res) => {
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
  });
  if (!booking) throw new AppError(404, "booking not found");
  res.json(serializeBooking(booking));
});

router.delete("/bookings/:id", async (req, res) => {
  const booking = await prisma.booking.findUnique({
    where: { id: req.params.id },
  });
  if (!booking) throw new AppError(404, "booking not found");
  if (booking.status === "cancelled") {
    throw new AppError(409, "booking already cancelled");
  }

  const updated = await prisma.$transaction(async (transaction) => {
    const result = await transaction.booking.updateMany({
      where: { id: req.params.id, status: "confirmed" },
      data: { status: "cancelled" },
    });
    if (result.count === 1) {
      return transaction.booking.findUniqueOrThrow({
        where: { id: req.params.id },
      });
    }
    const current = await transaction.booking.findUnique({
      where: { id: req.params.id },
    });
    if (!current) throw new AppError(404, "booking not found");
    if (current.status === "cancelled") {
      throw new AppError(409, "booking already cancelled");
    }
    throw new Error("Booking status changed unexpectedly");
  });
  res.json(serializeBooking(updated));
});

export default router;
