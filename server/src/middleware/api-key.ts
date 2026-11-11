import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";

export function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const expectedKey = process.env.API_KEY;
  const suppliedKey = req.header("X-API-Key");

  if (!expectedKey || !suppliedKey) {
    res.status(401).json({
      error: "Unauthorized",
    });
    return;
  }

  const expected = Buffer.from(expectedKey);
  const supplied = Buffer.from(suppliedKey);

  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  ) {
    res.status(401).json({
      error: "Unauthorized",
    });
    return;
  }

  next();
}