import "dotenv/config";
import express, { type RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { apiKeyAuth } from "./middleware/api-key.js";
import apiRouter from "./routes/api.js";
import { errorHandler } from "./middleware/error-handler.js";
import { openApiSpec } from "./docs/openapi.js";

const app = express();
const swaggerDocsCsp: RequestHandler = (_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
  );
  next();
};

app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN
      ? process.env.CLIENT_ORIGIN.split(",")
      : "http://localhost:5173",
  })
);

app.use(
  "/docs",
  swaggerDocsCsp,
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec)
);

app.get("/openapi.json", (_req, res) => {
  res.json(openApiSpec);
});

// Protect the assessment API endpoints
app.use(apiKeyAuth);
app.use(express.json({ limit: "1mb" }));

app.use(apiRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "not found" });
});

app.use(errorHandler);

export default app;