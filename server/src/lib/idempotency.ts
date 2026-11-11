import { createHash } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";

export function hashRequest(input: unknown): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function storeIdempotencyResponse(
  transaction: Prisma.TransactionClient,
  key: string,
  requestHash: string,
  responseStatus: number,
  responseBody: object
) {
  await transaction.idempotencyRecord.create({
    data: { key, requestHash, responseStatus, responseBody },
  });
}
