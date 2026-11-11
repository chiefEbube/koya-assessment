import type { Prisma } from "../generated/prisma/client.js";

export async function acquireAdvisoryLock(
  transaction: Prisma.TransactionClient,
  key: string
) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}
