const DEFAULT_HEADERS = {
  "access-control-allow-headers":
    "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "600",
  "vary": "Origin",
};

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return true;

  const configured = Deno.env.get("APP_BASE_URL")?.trim();
  if (configured) {
    try {
      if (new URL(configured).origin === origin) return true;
    } catch {
      return false;
    }
  }

  return !configured && isLoopbackOrigin(origin);
}

export function corsHeaders(request: Request): Headers {
  const headers = new Headers(DEFAULT_HEADERS);
  const origin = request.headers.get("origin");
  if (origin && isAllowedOrigin(origin)) {
    headers.set("access-control-allow-origin", origin);
  }
  return headers;
}

export function preflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  const origin = request.headers.get("origin") ?? "";
  if (origin && !isAllowedOrigin(origin)) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function jsonResponse(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  const headers = corsHeaders(request);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

export function assertAllowedOrigin(request: Request): void {
  const origin = request.headers.get("origin") ?? "";
  if (origin && !isAllowedOrigin(origin)) {
    throw new HttpError(
      403,
      "ORIGIN_NOT_ALLOWED",
      "This request origin is not allowed.",
    );
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function handleError(request: Request, error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse(
      request,
      { error: error.code, message: error.message },
      error.status,
    );
  }
  // Do not send database/provider response bodies or stack traces to browsers.
  return jsonResponse(
    request,
    {
      error: "INTERNAL_ERROR",
      message: "The request could not be completed. Please try again.",
    },
    500,
  );
}

export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Send a JSON request body.",
    );
  }

  const raw = await request.text();
  if (raw.length > 16_384) {
    throw new HttpError(413, "REQUEST_TOO_LARGE", "The request is too large.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(
      400,
      "INVALID_JSON",
      "The request body is not valid JSON.",
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(
      400,
      "INVALID_BODY",
      "The request body must be a JSON object.",
    );
  }

  return parsed as Record<string, unknown>;
}
