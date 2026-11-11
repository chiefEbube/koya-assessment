import type { IncomingMessage, ServerResponse } from "node:http";

interface ProxyRequest extends IncomingMessage {
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ProxyResponse extends ServerResponse {
  status(code: number): this;
  json(body: unknown): this;
  send(body: Buffer): this;
}

function upstreamUrl(request: ProxyRequest): URL | undefined {
  const base = process.env.BACKEND_API_URL;
  if (!base) return undefined;

  const route = request.query.path;
  const path = Array.isArray(route) ? route.join("/") : route ?? "";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const target = new URL(path, normalizedBase);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query)) {
    if (key === "path" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      query.append(key, item);
    }
  }
  target.search = query.toString();
  return target;
}

export default async function handler(
  request: ProxyRequest,
  response: ProxyResponse
) {
  const target = upstreamUrl(request);
  const apiKey = process.env.BACKEND_API_KEY;
  if (!target || !apiKey) {
    response.status(500).json({ error: "API proxy is not configured" });
    return;
  }

  try {
    const headers = new Headers();
    const contentType = request.headers["content-type"];
    if (typeof contentType === "string") headers.set("Content-Type", contentType);
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey === "string") {
      headers.set("Idempotency-Key", idempotencyKey);
    }
    headers.set("X-API-Key", apiKey);

    const method = request.method ?? "GET";
    let body: BodyInit | undefined;
    if (method !== "GET" && method !== "HEAD") {
      if (typeof request.body === "string") {
        body = request.body;
      } else if (request.body instanceof Buffer) {
        body = request.body.toString("utf8");
      } else if (request.body !== undefined) {
        body = JSON.stringify(request.body);
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }
      }
    }

    const upstream = await fetch(target, {
      method,
      headers,
      body,
      redirect: "manual",
    });
    const upstreamContentType = upstream.headers.get("content-type");
    const retryAfter = upstream.headers.get("retry-after");
    if (upstreamContentType) response.setHeader("Content-Type", upstreamContentType);
    if (retryAfter) response.setHeader("Retry-After", retryAfter);
    response.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error("API proxy request failed:", error);
    response.status(502).json({ error: "upstream API unavailable" });
  }
}
