import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const headers = {
  "X-API-Key": process.env.API_KEY ?? "integration-test-key",
};

function slot(id: string) {
  return {
    id,
    provider: "Dr Test",
    start: "2099-12-10T09:00:00.000Z",
    end: "2099-12-10T09:30:00.000Z",
  };
}

async function reset(slots = [slot("slot-1")]) {
  await request(app).post("/reset").set(headers).send({ slots }).expect(200);
}

describe("clinic booking API", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await reset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("resets slots, lists availability, creates a booking, and fetches it", async () => {
    const resetResponse = await request(app)
      .post("/reset")
      .set(headers)
      .send({ slots: [slot("slot-1")] })
      .expect(200);
    expect(resetResponse.text).toBe("");

    await request(app)
      .get("/slots")
      .set(headers)
      .expect(200)
      .expect(({ body }) => {
        expect(body.slots).toHaveLength(1);
        expect(body.slots[0].available).toBe(true);
      });

    const response = await request(app)
      .post("/bookings")
      .set(headers)
      .send({ slot_id: "slot-1", name: " Ada Obi ", email: " ADA@EXAMPLE.COM " })
      .expect(201);
    expect(response.body).toMatchObject({
      slot_id: "slot-1",
      name: "Ada Obi",
      email: "ada@example.com",
      status: "confirmed",
    });

    await request(app)
      .get(`/bookings/${response.body.id}`)
      .set(headers)
      .expect(200)
      .expect(({ body }) => expect(body.id).toBe(response.body.id));
  });

  it("requires the API key and validates booking fields", async () => {
    await request(app).get("/slots").expect(401);
    await request(app)
      .post("/bookings")
      .set("Content-Type", "application/json")
      .send("{")
      .expect(401);
    await request(app)
      .post("/bookings")
      .set(headers)
      .send({ slot_id: "slot-1", name: " ", email: "invalid" })
      .expect(400);
    await request(app)
      .post("/bookings")
      .set(headers)
      .send({ slot_id: "missing", name: "Ada", email: "ada@example.com" })
      .expect(404);
  });

  it("allows exactly one concurrent booking for a slot", async () => {
    const payload = {
      slot_id: "slot-1",
      name: "Ada",
      email: "ada@example.com",
    };
    const results = await Promise.all([
      request(app).post("/bookings").set(headers).send(payload),
      request(app).post("/bookings").set(headers).send(payload),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  });

  it("replays idempotent responses and rejects key reuse with another body", async () => {
    const payload = {
      slot_id: "slot-1",
      name: "Ada",
      email: "ada@example.com",
    };
    const first = await request(app)
      .post("/bookings")
      .set(headers)
      .set("Idempotency-Key", "same-key")
      .send(payload)
      .expect(201);
    const replay = await request(app)
      .post("/bookings")
      .set(headers)
      .set("Idempotency-Key", "same-key")
      .send(payload)
      .expect(201);
    expect(replay.body).toEqual(first.body);

    await request(app)
      .post("/bookings")
      .set(headers)
      .set("Idempotency-Key", "same-key")
      .send({ ...payload, name: "Different" })
      .expect(422);

    const invalidPayload = {
      slot_id: "missing-slot",
      name: "Ada",
      email: "ada@example.com",
    };
    const notFound = await request(app)
      .post("/bookings")
      .set(headers)
      .set("Idempotency-Key", "cached-error")
      .send(invalidPayload)
      .expect(404);
    await request(app)
      .post("/bookings")
      .set(headers)
      .set("Idempotency-Key", "cached-error")
      .send(invalidPayload)
      .expect(404)
      .expect(notFound.body);
  });

  it("serializes concurrent requests using the same new idempotency key", async () => {
    const payload = {
      slot_id: "slot-1",
      name: "Ada",
      email: "ada@example.com",
    };
    const results = await Promise.all([
      request(app)
        .post("/bookings")
        .set(headers)
        .set("Idempotency-Key", "parallel-key")
        .send(payload),
      request(app)
        .post("/bookings")
        .set(headers)
        .set("Idempotency-Key", "parallel-key")
        .send(payload),
    ]);
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    expect(results[0].body).toEqual(results[1].body);
  });

  it("paginates bookings deterministically and cancels bookings once", async () => {
    await reset([slot("slot-1"), slot("slot-2")]);
    const ids: string[] = [];
    for (const slotId of ["slot-1", "slot-2"]) {
      const response = await request(app)
        .post("/bookings")
        .set(headers)
        .send({ slot_id: slotId, name: "Ada", email: "ada@example.com" })
        .expect(201);
      ids.push(response.body.id);
    }

    const firstPage = await request(app)
      .get("/bookings")
      .query({ email: "ADA@example.com", limit: 1 })
      .set(headers)
      .expect(200);
    expect(firstPage.body.bookings).toHaveLength(1);
    expect(firstPage.body.next_cursor).toEqual(expect.any(String));

    const secondPage = await request(app)
      .get("/bookings")
      .query({
        email: "ada@example.com",
        limit: 1,
        cursor: firstPage.body.next_cursor,
      })
      .set(headers)
      .expect(200);
    expect(secondPage.body.bookings).toHaveLength(1);
    expect(secondPage.body.bookings[0].id).not.toBe(firstPage.body.bookings[0].id);
    expect(secondPage.body.next_cursor).toBeNull();

    const bookingId = ids[0];
    await request(app)
      .delete(`/bookings/${bookingId}`)
      .set(headers)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe("cancelled"));
    await request(app)
      .delete(`/bookings/${bookingId}`)
      .set(headers)
      .expect(409);
  });

  it("limits each email to five attempts in parallel and supplies Retry-After", async () => {
    await reset(Array.from({ length: 6 }, (_, index) => slot(`slot-${index}`)));
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        request(app)
          .post("/bookings")
          .set(headers)
          .send({
            slot_id: `slot-${index}`,
            name: "Ada",
            email: "ada@example.com",
          })
      )
    );

    expect(results.filter((result) => result.status === 201)).toHaveLength(5);
    const limited = results.filter((result) => result.status === 429);
    expect(limited).toHaveLength(1);
    const retryAfter = limited[0]?.headers["retry-after"];
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it("does not charge idempotent replays against the attempt limit", async () => {
    await reset(Array.from({ length: 6 }, (_, index) => slot(`slot-${index}`)));
    const firstPayload = {
      slot_id: "slot-0",
      name: "Ada",
      email: "ada@example.com",
    };
    const first = await request(app)
      .post("/bookings")
      .set(headers)
      .set("Idempotency-Key", "replay-does-not-count")
      .send(firstPayload)
      .expect(201);
    await request(app)
      .post("/bookings")
      .set(headers)
      .set("Idempotency-Key", "replay-does-not-count")
      .send(firstPayload)
      .expect(201);

    for (let index = 1; index < 5; index += 1) {
      await request(app)
        .post("/bookings")
        .set(headers)
        .send({
          slot_id: `slot-${index}`,
          name: "Ada",
          email: "ada@example.com",
        })
        .expect(201);
    }
    await request(app)
      .post("/bookings")
      .set(headers)
      .send({
        slot_id: "slot-5",
        name: "Ada",
        email: "ada@example.com",
      })
      .expect(429);
    expect(first.body.id).toEqual(expect.any(String));
  });
});
