# Clinic booking

Clinic booking is a small appointment API and browser client. The Express API uses Prisma with PostgreSQL; the React application talks to the API through a same-origin proxy so the API key never enters browser code.

## Architecture

```text
Browser ── /api/* ──> Vercel serverless proxy ── X-API-Key ──> Render Express API ──> PostgreSQL
Evaluators ─────────────────────────── X-API-Key ────────────> Render Express API
```

The API is implemented in `server/`, the Vite application and Vercel proxy in `client/`. Booking uniqueness is enforced by the partial PostgreSQL index on confirmed bookings, while transaction-scoped advisory locks serialize same-key idempotency, per-email rate-limit attempts, and same-slot requests.

## Local development

Requirements: Node.js 20+ and a PostgreSQL database.

1. Copy `server/.env.example` to `server/.env` and set `DATABASE_URL`, `DIRECT_URL`, and `API_KEY`.
2. In `server/`, run `npm ci`, `npm run db:deploy`, and `npm run dev`.
3. Copy `client/.env.example` to `client/.env`, set `BACKEND_API_KEY` to the same API key, then run `npm ci` and `npm run dev` in `client/`.
4. Open the Vite URL (normally `http://localhost:5173`). The Vite development proxy injects the API key server-side.

Do not use a `VITE_API_KEY` variable. Only `BACKEND_API_URL` and `BACKEND_API_KEY` are read by server-side proxy code.

## API

Swagger UI is available publicly at `/docs`, with the OpenAPI 3 specification at `/openapi.json`. All six assessment API routes require `X-API-Key`; the documentation endpoints do not.

| Method | Path | Purpose |
|---|---|---|
| GET | `/docs` | Interactive Swagger UI documentation (public) |
| GET | `/openapi.json` | OpenAPI 3 specification (public) |
| POST | `/reset` | Replace all slots and clear bookings/attempts/idempotency data; responds with an empty 200 body |
| GET | `/slots` | List all slots by start time; optional exact-match `provider` filter |
| POST | `/bookings` | Create a confirmed booking; supports `Idempotency-Key` and per-email rate limiting |
| GET | `/bookings/:id` | Get a booking |
| DELETE | `/bookings/:id` | Cancel a confirmed booking |
| GET | `/bookings?email=...` | List a person's bookings with `limit` and `cursor` pagination |

## Tests and database safety

The integration tests call `/reset`, which deletes all booking data and slots. **Never point them at production or a shared database.**

Create `server/.env.test` from `server/.env.test.example`, and provide a dedicated local database or isolated Neon test branch using `TEST_DATABASE_URL` and `TEST_DIRECT_URL`. The test setup requires the explicit `ALLOW_DESTRUCTIVE_TEST_DB=yes` opt-in and refuses to run if the test URL matches the normal `server/.env` database URL.

From `server/`, apply migrations to that test database with `npm run db:deploy:test`, then run `npm test`. Both commands load only the explicit test URLs from `.env.test` and refuse to proceed if they match `server/.env`. The suite covers authentication, validation, booking/cancellation, booking-list cursor pagination, idempotency replays, and concurrent slot/rate-limit requests.

## Deployment

### Render API

The root `render.yaml` configures the service with `server/` as its root, `npm ci && npm run build`, `npm run db:deploy` as the pre-deploy migration, and `npm start`. Set:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Pooled production PostgreSQL connection |
| `DIRECT_URL` | Direct PostgreSQL connection used by Prisma migrations |
| `API_KEY` | Secret key accepted by the API and submitted to the assessment |
| `CLIENT_ORIGIN` | Exact Vercel origin allowed by CORS |

### Vercel client and proxy

Deploy with `client/` as the Vercel project root. The `client/api/[...path].ts` function forwards requests to `BACKEND_API_URL` and injects `BACKEND_API_KEY`; configure both as server-only Vercel environment variables. `BACKEND_API_KEY` must match Render's `API_KEY`. Do not add a `VITE_` prefix to either secret.

Before sharing the deployment, smoke-test `/openapi.json` and the authenticated API directly on Render, then test the client through Vercel. Production deployment and credential-dependent smoke tests must be completed in the hosting accounts.
