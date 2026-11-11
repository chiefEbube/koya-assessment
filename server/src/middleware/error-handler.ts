import type { ErrorRequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { mapPrismaError } from "../lib/prisma-errors.js";

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  _next
) => {
  const mapped = error instanceof AppError ? error : mapPrismaError(error);
  if (mapped) {
    for (const [name, value] of Object.entries(mapped.headers)) {
      res.setHeader(name, value);
    }
    res.status(mapped.statusCode).json({ error: mapped.message });
    return;
  }

  const status =
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500
      ? error.status
      : 500;
  if (status >= 400 && status < 500) {
    res.status(status).json({
      error: status === 413 ? "request body too large" : "invalid request body",
    });
    return;
  }

  console.error("Unhandled API error:", error);
  res.status(500).json({ error: "internal server error" });
};
