import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { apiKeyAuth } from "./middleware/api-key.js";
import apiRouter from "./routes/api.js";
import { errorHandler } from "./middleware/error-handler.js";

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN
      ? process.env.CLIENT_ORIGIN.split(",")
      : "http://localhost:5173",
  })
);

// Public health check
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "clinic-booking-api",
  });
});

// Protect the assessment API endpoints
app.use(apiKeyAuth);
app.use(express.json({ limit: "10kb" }));

app.use(apiRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "not found" });
});

app.use(errorHandler);

export default app;