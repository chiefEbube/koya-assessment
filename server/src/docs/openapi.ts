const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: { type: "string" },
  },
} as const;

const bookingSchema = {
  type: "object",
  required: ["id", "slot_id", "name", "email", "status", "created_at"],
  properties: {
    id: { type: "string" },
    slot_id: { type: "string" },
    name: { type: "string" },
    email: { type: "string", format: "email" },
    status: { type: "string", enum: ["confirmed", "cancelled"] },
    created_at: { type: "string", format: "date-time" },
  },
} as const;

const slotSchema = {
  type: "object",
  required: ["id", "provider", "start", "end", "available"],
  properties: {
    id: { type: "string" },
    provider: { type: "string" },
    start: { type: "string", format: "date-time" },
    end: { type: "string", format: "date-time" },
    available: { type: "boolean" },
  },
} as const;

const unauthorizedResponse = {
  description: "Missing or invalid X-API-Key.",
  content: {
    "application/json": {
      schema: errorSchema,
      example: { error: "Unauthorized" },
    },
  },
} as const;

const invalidRequestResponse = {
  description: "The request parameters or body are invalid.",
  content: {
    "application/json": {
      schema: errorSchema,
    },
  },
} as const;

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Clinic Booking API",
    version: "1.0.0",
    description:
      "API for listing appointment availability and creating, viewing, or cancelling bookings.",
  },
  servers: [{ url: "/", description: "Current server" }],
  tags: [
    { name: "Availability" },
    { name: "Bookings" },
    { name: "Administration" },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      },
    },
    schemas: {
      Error: errorSchema,
      Booking: bookingSchema,
      Slot: slotSchema,
    },
    parameters: {
      Limit: {
        name: "limit",
        in: "query",
        description: "Maximum number of results (default 10; range 1–50).",
        schema: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
      Cursor: {
        name: "cursor",
        in: "query",
        description: "Opaque cursor returned by the previous page.",
        schema: { type: "string" },
      },
    },
  },
  security: [{ ApiKeyAuth: [] }],
  paths: {
    "/slots": {
      get: {
        tags: ["Availability"],
        summary: "List appointment slots",
        parameters: [
          {
            name: "provider",
            in: "query",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "All slots ordered by start time, then id.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["slots"],
                  properties: {
                    slots: { type: "array", items: { $ref: "#/components/schemas/Slot" } },
                  },
                },
              },
            },
          },
          "400": invalidRequestResponse,
          "401": unauthorizedResponse,
        },
      },
    },
    "/reset": {
      post: {
        tags: ["Administration"],
        summary: "Replace all slots and clear booking data",
        description:
          "Deletes existing bookings, attempts, idempotency records, and slots, then creates the supplied slots.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["slots"],
                properties: {
                  slots: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["id", "provider", "start", "end"],
                      properties: {
                        id: { type: "string", minLength: 1 },
                        provider: { type: "string", minLength: 1 },
                        start: { type: "string", format: "date-time" },
                        end: { type: "string", format: "date-time" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Data was reset. The response body is empty." },
          "400": invalidRequestResponse,
          "401": unauthorizedResponse,
        },
      },
    },
    "/bookings": {
      get: {
        tags: ["Bookings"],
        summary: "List bookings for an email address",
        parameters: [
          {
            name: "email",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 1 },
          },
          {
            name: "status",
            in: "query",
            description: "Optionally filter bookings before pagination.",
            schema: { type: "string", enum: ["confirmed", "cancelled"] },
          },
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
        ],
        responses: {
          "200": {
            description: "A page of bookings for the requested email.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["bookings", "next_cursor"],
                  properties: {
                    bookings: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Booking" },
                    },
                    next_cursor: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
          "400": invalidRequestResponse,
          "401": unauthorizedResponse,
        },
      },
      post: {
        tags: ["Bookings"],
        summary: "Create a confirmed booking",
        description:
          "Booking attempts are rate-limited per email. Reuse an Idempotency-Key to safely retry the same request.",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            description: "Makes retries with the same request body idempotent.",
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["slot_id", "name", "email"],
                properties: {
                  slot_id: { type: "string", minLength: 1 },
                  name: { type: "string", minLength: 1 },
                  email: { type: "string", format: "email" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Booking created.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Booking" },
              },
            },
          },
          "400": {
            description: "Invalid booking request or the slot has already started.",
            content: { "application/json": { schema: errorSchema } },
          },
          "401": unauthorizedResponse,
          "404": {
            description: "Slot not found.",
            content: { "application/json": { schema: errorSchema } },
          },
          "409": {
            description: "Slot is already booked.",
            content: { "application/json": { schema: errorSchema } },
          },
          "422": {
            description: "Idempotency key was reused with a different request body.",
            content: { "application/json": { schema: errorSchema } },
          },
          "429": {
            description: "Too many booking attempts for this email.",
            headers: {
              "Retry-After": {
                description: "Seconds to wait before retrying.",
                schema: { type: "integer" },
              },
            },
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
    "/bookings/{id}": {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      get: {
        tags: ["Bookings"],
        summary: "Get a booking",
        responses: {
          "200": {
            description: "The requested booking.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Booking" },
              },
            },
          },
          "401": unauthorizedResponse,
          "404": {
            description: "Booking not found.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
      delete: {
        tags: ["Bookings"],
        summary: "Cancel a booking",
        responses: {
          "200": {
            description: "The cancelled booking.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Booking" },
              },
            },
          },
          "401": unauthorizedResponse,
          "404": {
            description: "Booking not found.",
            content: { "application/json": { schema: errorSchema } },
          },
          "409": {
            description: "Booking is already cancelled.",
            content: { "application/json": { schema: errorSchema } },
          },
        },
      },
    },
  },
} as const;
